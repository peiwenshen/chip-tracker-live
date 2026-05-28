import { useCallback, useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import supabase from "@/lib/supabaseClient";
import {
  createRoomAndJoin,
  fetchRoomPlayers,
  fetchTransactions,
  getRoom,
  joinRoom,
  leaveRoom,
  renamePlayer,
  transferChips,
} from "@/lib/chipTrackerApi";
import type { RoomPlayer, Transaction } from "@/types";

const PLAYER_ID_KEY = "playerId";
const PLAYER_NAME_KEY = "playerName";
const ROOM_ID_KEY = "roomId";
const TRANSFER_AMOUNTS = [10, 20, 50, 100];

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error && "message" in error) {
    return String(error.message);
  }
  return String(error);
};

const getFriendlyErrorMessage = (error: unknown) => {
  const message = getErrorMessage(error);
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("transfer_chips") ||
    (normalizedMessage.includes("function") && normalizedMessage.includes("not found"))
  ) {
    return "Supabase transfer setup is missing. Apply supabase/sql/001_schema.sql before using transfers.";
  }

  if (normalizedMessage.includes("insufficient chips")) {
    return "You do not have enough chips for this transfer.";
  }

  if (normalizedMessage.includes("cannot transfer chips to yourself")) {
    return "Choose another player before transferring chips.";
  }

  if (normalizedMessage.includes("both players must be in this room")) {
    return "Both players must still be in the room to transfer chips.";
  }

  if (normalizedMessage.includes("row-level security")) {
    return "Supabase rejected this action because of database security rules.";
  }

  if (normalizedMessage.includes("duplicate key")) {
    return "That record already exists. Refresh and try again.";
  }

  return message;
};

const getStoredValue = (key: string) => localStorage.getItem(key) ?? "";

const ChipTracker = () => {
  const [playerId] = useState(() => {
    const storedId = getStoredValue(PLAYER_ID_KEY);
    if (storedId) return storedId;

    const newId = uuidv4();
    localStorage.setItem(PLAYER_ID_KEY, newId);
    return newId;
  });

  const [nameInput, setNameInput] = useState(() => getStoredValue(PLAYER_NAME_KEY));
  const [playerName, setPlayerName] = useState(() => getStoredValue(PLAYER_NAME_KEY));
  const [roomInput, setRoomInput] = useState(() => getStoredValue(ROOM_ID_KEY));
  const [roomId, setRoomId] = useState(() => getStoredValue(ROOM_ID_KEY));
  const [hasJoinedRoom, setHasJoinedRoom] = useState(() => Boolean(getStoredValue(ROOM_ID_KEY)));

  const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState("");
  const [transferAmount, setTransferAmount] = useState<number | null>(null);
  const [customTransferAmount, setCustomTransferAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const currentPlayer = useMemo(
    () => roomPlayers.find((roomPlayer) => roomPlayer.player_id === playerId) ?? null,
    [playerId, roomPlayers]
  );

  const selectedPlayerData = useMemo(
    () => roomPlayers.find((roomPlayer) => roomPlayer.player_id === selectedPlayer) ?? null,
    [roomPlayers, selectedPlayer]
  );

  const playerNamesById = useMemo(() => {
    return new Map(roomPlayers.map((roomPlayer) => [roomPlayer.player_id, roomPlayer.players?.name ?? roomPlayer.player_id]));
  }, [roomPlayers]);

  const isTransferAmountInvalid =
    transferAmount === null ||
    !Number.isInteger(transferAmount) ||
    transferAmount <= 0 ||
    (currentPlayer ? transferAmount > currentPlayer.chips : true);

  const persistRoom = useCallback((nextRoomId: string) => {
    setRoomId(nextRoomId);
    setRoomInput(nextRoomId);
    setHasJoinedRoom(Boolean(nextRoomId));

    if (nextRoomId) {
      localStorage.setItem(ROOM_ID_KEY, nextRoomId);
    } else {
      localStorage.removeItem(ROOM_ID_KEY);
    }
  }, []);

  const clearRoomState = useCallback(() => {
    persistRoom("");
    setRoomPlayers([]);
    setTransactions([]);
    setSelectedPlayer("");
    setTransferAmount(null);
    setCustomTransferAmount("");
  }, [persistRoom]);

  const loadRoomData = useCallback(async (targetRoomId = roomId) => {
    if (!targetRoomId) return;

    setError(null);
    try {
      const [players, roomTransactions] = await Promise.all([
        fetchRoomPlayers(targetRoomId),
        fetchTransactions(targetRoomId),
      ]);

      if (!players.some((roomPlayer) => roomPlayer.player_id === playerId)) {
        clearRoomState();
        setError("You are no longer a member of this room. Join again to continue.");
        return;
      }

      setRoomPlayers(players);
      setTransactions(roomTransactions);
    } catch (loadError) {
      setError(`Error loading room: ${getFriendlyErrorMessage(loadError)}`);
    }
  }, [clearRoomState, playerId, roomId]);

  useEffect(() => {
    if (!roomId || !hasJoinedRoom) return;
    void loadRoomData();
  }, [hasJoinedRoom, loadRoomData, roomId]);

  useEffect(() => {
    if (!roomId || !hasJoinedRoom) return;

    const roomChannel = supabase
      .channel(`room_${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_players",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          void loadRoomData();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "transactions",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          void loadRoomData();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(roomChannel);
    };
  }, [hasJoinedRoom, loadRoomData, roomId]);

  const handleSaveName = async () => {
    const nextName = nameInput.trim();
    if (!nextName) {
      setError("Enter a player name.");
      return;
    }

    setError(null);
    localStorage.setItem(PLAYER_NAME_KEY, nextName);
    setPlayerName(nextName);

    if (!hasJoinedRoom) return;

    try {
      await renamePlayer(playerId, nextName);
      setSuccessMessage("Name updated.");
      window.setTimeout(() => setSuccessMessage(null), 2500);
    } catch (renameError) {
      setError(`Error renaming player: ${getFriendlyErrorMessage(renameError)}`);
    }
  };

  const handleJoinRoom = async () => {
    const nextName = nameInput.trim();
    const nextRoomId = roomInput.trim().toLowerCase();

    if (!nextName || !nextRoomId) {
      setError("Enter a player name and room code.");
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      const room = await getRoom(nextRoomId);
      if (!room) {
        setError("Room not found. Check the room code or create a new room.");
        return;
      }

      await joinRoom(nextRoomId, playerId, nextName);
      localStorage.setItem(PLAYER_NAME_KEY, nextName);
      setPlayerName(nextName);
      persistRoom(nextRoomId);
      await loadRoomData(nextRoomId);
    } catch (joinError) {
      setError(`Error joining room: ${getFriendlyErrorMessage(joinError)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateRoom = async () => {
    const nextName = nameInput.trim();
    if (!nextName) {
      setError("Enter a player name before creating a room.");
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      const nextRoomId = await createRoomAndJoin(playerId, nextName);
      localStorage.setItem(PLAYER_NAME_KEY, nextName);
      setPlayerName(nextName);
      persistRoom(nextRoomId);
      await loadRoomData(nextRoomId);
    } catch (createError) {
      setError(`Error creating room: ${getFriendlyErrorMessage(createError)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleLeaveRoom = async () => {
    if (!roomId) return;

    setIsBusy(true);
    setError(null);
    try {
      await leaveRoom(roomId, playerId);
      await supabase.removeAllChannels();
      clearRoomState();
    } catch (leaveError) {
      setError(`Error leaving room: ${getFriendlyErrorMessage(leaveError)}`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCustomAmountChange = (value: string) => {
    const sanitizedValue = value.replace(/\D/g, "");
    setCustomTransferAmount(sanitizedValue);
    setTransferAmount(sanitizedValue ? Number(sanitizedValue) : null);
  };

  const handleChipTransfer = async () => {
    if (!roomId || !selectedPlayer || !transferAmount) return;

    if (!Number.isInteger(transferAmount) || transferAmount <= 0) {
      setError("Enter a positive whole number of chips.");
      return;
    }

    if (!currentPlayer) {
      setError("Your player record was not found in this room.");
      return;
    }

    if (transferAmount > currentPlayer.chips) {
      setError("You do not have enough chips for this transfer.");
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      await transferChips(roomId, playerId, selectedPlayer, transferAmount);
      await loadRoomData();
      setTransferAmount(null);
      setCustomTransferAmount("");
      setSelectedPlayer("");
    } catch (transferError) {
      setError(`Error transferring chips: ${getFriendlyErrorMessage(transferError)}`);
    } finally {
      setIsBusy(false);
    }
  };

  if (!playerName || !hasJoinedRoom) {
    return (
      <div className="w-full px-4 sm:px-6 md:px-8 mx-auto max-w-xl">
        <div className="w-full max-w-md backdrop-blur-lg bg-white/95 shadow-2xl rounded-lg">
          <div className="bg-blue-600 text-white space-y-2 p-6 rounded-t-lg">
            <h1 className="text-2xl sm:text-3xl font-bold text-center">Poker Chip Tracker</h1>
          </div>

          <div className="p-6 space-y-6">
            {error && (
              <div className="text-red-700 text-center bg-red-50 p-3 rounded-lg border border-red-200">
                {error}
              </div>
            )}

            {successMessage && (
              <div className="text-green-700 text-center bg-green-50 p-3 rounded-lg border border-green-200">
                {successMessage}
              </div>
            )}

            <div className="space-y-3">
              <input
                value={nameInput}
                onChange={(event) => setNameInput(event.target.value)}
                placeholder="Your name"
                className="w-full border border-gray-300 p-3 rounded-md text-gray-900"
              />
              <button
                className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-md disabled:opacity-50"
                onClick={handleSaveName}
                disabled={isBusy || !nameInput.trim()}
              >
                Save Name
              </button>
            </div>

            <div className="space-y-3">
              <input
                value={roomInput}
                onChange={(event) => setRoomInput(event.target.value)}
                placeholder="Room code"
                className="w-full border border-gray-300 p-3 rounded-md text-gray-900"
              />
              <button
                className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded-md disabled:opacity-50"
                onClick={handleJoinRoom}
                disabled={isBusy || !nameInput.trim() || !roomInput.trim()}
              >
                Join Room
              </button>
              <button
                className="w-full bg-green-700 hover:bg-green-800 text-white py-2 rounded-md disabled:opacity-50"
                onClick={handleCreateRoom}
                disabled={isBusy || !nameInput.trim()}
              >
                Create New Room
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 sm:p-6">
      <div className="w-full max-w-4xl mx-auto shadow-xl rounded-lg overflow-hidden bg-white">
        <div className="bg-gray-800 text-white flex flex-col sm:flex-row justify-between items-center gap-4 p-6">
          <div className="space-y-2 text-center sm:text-left">
            <h1 className="text-xl sm:text-2xl font-bold">Room: {roomId}</h1>
            <p className="text-gray-300 text-sm">Welcome, {playerName}</p>
          </div>
          <button
            type="button"
            className="bg-red-600 hover:bg-red-700 transition-colors text-white py-2 px-4 disabled:opacity-50"
            onClick={handleLeaveRoom}
            disabled={isBusy}
          >
            Leave Room
          </button>
        </div>

        <div className="p-6 space-y-8">
          {error && (
            <div className="text-red-700 text-center bg-red-50 p-3 rounded-lg border border-red-200">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <section className="bg-white rounded-lg p-6 shadow-md border border-gray-100">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">Players</h2>
              {roomPlayers.length > 0 ? (
                <ul className="divide-y divide-gray-200">
                  {roomPlayers.map((roomPlayer) => (
                    <li key={roomPlayer.id} className="flex justify-between items-center gap-4 py-3">
                      <span className="font-medium text-gray-800 min-w-0">
                        {roomPlayer.players?.name || roomPlayer.player_id}
                        {roomPlayer.player_id === playerId && (
                          <span className="ml-2 text-sm text-blue-600">(You)</span>
                        )}
                      </span>
                      <span className="font-bold text-gray-900 whitespace-nowrap">{roomPlayer.chips} chips</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500 text-center">No players in the room.</p>
              )}
            </section>

            <div className="space-y-8">
              <section className="bg-white rounded-lg p-6 shadow-md border border-gray-100">
                <h2 className="text-xl font-semibold mb-6 text-gray-800">Transfer Chips</h2>
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Select Player</label>
                    <select
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                      onChange={(event) => setSelectedPlayer(event.target.value)}
                      value={selectedPlayer}
                      disabled={isBusy}
                    >
                      <option value="">Choose a player</option>
                      {roomPlayers
                        .filter((roomPlayer) => roomPlayer.player_id !== playerId)
                        .map((roomPlayer) => (
                          <option key={roomPlayer.id} value={roomPlayer.player_id}>
                            {roomPlayer.players?.name || roomPlayer.player_id}
                          </option>
                        ))}
                    </select>
                  </div>

                  {selectedPlayerData && (
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <h3 className="font-semibold text-blue-800">
                        {selectedPlayerData.players?.name || selectedPlayerData.player_id}
                      </h3>
                      <p className="text-sm text-blue-600">
                        Current Balance: {selectedPlayerData.chips} chips
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Amount</label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {TRANSFER_AMOUNTS.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          onClick={() => {
                            setTransferAmount(amount);
                            setCustomTransferAmount(String(amount));
                          }}
                          disabled={isBusy || (currentPlayer ? amount > currentPlayer.chips : true)}
                          className={`py-2 px-4 transition-colors disabled:opacity-50 ${
                            transferAmount === amount
                              ? "bg-blue-700 ring-2 ring-blue-300"
                              : "bg-blue-500 hover:bg-blue-600"
                          } text-white`}
                        >
                          {amount}
                        </button>
                      ))}
                    </div>
                    <input
                      value={customTransferAmount}
                      onChange={(event) => handleCustomAmountChange(event.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="Custom amount"
                      className="mt-3 w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900"
                      disabled={isBusy}
                    />
                  </div>

                  <button
                    type="button"
                    className="w-full bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 text-white py-2"
                    onClick={handleChipTransfer}
                    disabled={isBusy || !selectedPlayer || isTransferAmountInvalid}
                  >
                    Transfer {transferAmount ?? 0} Chips
                  </button>
                </div>
              </section>

              <section className="bg-white rounded-lg p-6 shadow-md border border-gray-100">
                <h2 className="text-xl font-semibold mb-4 text-gray-800">Recent Transactions</h2>
                {transactions.length > 0 ? (
                  <ul className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                    {transactions.map((transaction) => (
                      <li key={transaction.id} className="py-3 flex justify-between items-center gap-4">
                        <span className="text-gray-800 min-w-0">
                          <span className="font-medium">
                            {transaction.from_player_name ??
                              playerNamesById.get(transaction.from_player) ??
                              transaction.from_player}
                          </span>
                          <span className="mx-2">-&gt;</span>
                          <span className="font-medium">
                            {transaction.to_player_name ??
                              playerNamesById.get(transaction.to_player) ??
                              transaction.to_player}
                          </span>
                        </span>
                        <span className="font-bold text-gray-900 whitespace-nowrap">{transaction.amount} chips</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-500 text-center">No transactions yet.</p>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChipTracker;
