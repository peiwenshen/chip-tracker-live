import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleDollarSign, DoorOpen, LogOut, Plus, Send, Users } from "lucide-react";
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

  const totalChips = useMemo(() => {
    return roomPlayers.reduce((total, roomPlayer) => total + roomPlayer.chips, 0);
  }, [roomPlayers]);

  const otherPlayers = useMemo(() => {
    return roomPlayers.filter((roomPlayer) => roomPlayer.player_id !== playerId);
  }, [playerId, roomPlayers]);

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
      <main className="min-h-screen bg-[#f2eee6] px-3 py-3 text-[#1b1916] sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] w-full max-w-6xl items-center sm:min-h-[calc(100vh-3rem)]">
          <div className="grid w-full overflow-hidden rounded-lg border border-[#ded3bf] bg-[#fffaf0] shadow-2xl shadow-[#3b2d1a]/15 lg:grid-cols-[1.05fr_0.95fr]">
            <section className="flex flex-col justify-between bg-[#0f3128] p-5 text-white sm:p-8 lg:p-10">
              <div>
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-[#eee6d6] sm:mb-10 sm:text-sm">
                  <CircleDollarSign className="h-4 w-4 text-[#d8b45f]" />
                  Live table balance
                </div>
                <h1 className="max-w-xl text-3xl font-semibold leading-tight sm:text-5xl">
                  Poker Chip Tracker
                </h1>
                <p className="mt-3 max-w-md text-sm text-[#d8d0c2] sm:mt-5 sm:text-base">
                  Create a room, invite players, and keep chip transfers synced during the game.
                </p>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-2 text-xs text-[#d8d0c2] sm:mt-12 sm:gap-3 sm:text-sm">
                <div className="rounded-md border border-white/10 bg-white/10 p-3 sm:p-4">
                  <p className="text-lg font-semibold text-white sm:text-2xl">1,000</p>
                  <p>Starting chips</p>
                </div>
                <div className="rounded-md border border-white/10 bg-white/10 p-3 sm:p-4">
                  <p className="text-lg font-semibold text-white sm:text-2xl">Live</p>
                  <p>Room updates</p>
                </div>
                <div className="rounded-md border border-white/10 bg-white/10 p-3 sm:p-4">
                  <p className="text-lg font-semibold text-white sm:text-2xl">RPC</p>
                  <p>Safe transfers</p>
                </div>
              </div>
            </section>

            <section className="p-5 sm:p-8 lg:p-10">
              <div className="mb-5 sm:mb-8">
                <h2 className="text-xl font-semibold text-[#1b1916] sm:text-2xl">Join a table</h2>
                <p className="mt-2 text-sm text-[#766d5f]">Use a player name and room code, or create a new room.</p>
              </div>

              {error && (
                <div className="mb-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {successMessage && (
                <div className="mb-5 rounded-md border border-[#bfd9c7] bg-[#edf7ef] p-3 text-sm text-[#1f6b4f]">
                  {successMessage}
                </div>
              )}

              <div className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#4b4438]">Player name</label>
                  <input
                    value={nameInput}
                    onChange={(event) => setNameInput(event.target.value)}
                    placeholder="e.g. Alex"
                    className="min-h-11 w-full rounded-md border border-[#cfc2aa] bg-white px-3 py-2.5 text-base text-[#1b1916] outline-none transition focus:border-[#0f3128] focus:ring-4 focus:ring-[#d8c7a3]"
                  />
                </div>

                <button
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#0f3128] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#174338] disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleSaveName}
                  disabled={isBusy || !nameInput.trim()}
                >
                  <Users className="h-4 w-4" />
                  Save Name
                </button>

                <div className="pt-3">
                  <label className="mb-2 block text-sm font-medium text-[#4b4438]">Room code</label>
                  <input
                    value={roomInput}
                    onChange={(event) => setRoomInput(event.target.value)}
                    placeholder="Enter room code"
                    className="min-h-11 w-full rounded-md border border-[#cfc2aa] bg-white px-3 py-2.5 text-base text-[#1b1916] outline-none transition focus:border-[#0f3128] focus:ring-4 focus:ring-[#d8c7a3]"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#1f6b4f] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#18543f] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleJoinRoom}
                    disabled={isBusy || !nameInput.trim() || !roomInput.trim()}
                  >
                    <DoorOpen className="h-4 w-4" />
                    Join Room
                  </button>
                  <button
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#cfc2aa] bg-[#fffaf0] px-4 py-2.5 text-sm font-semibold text-[#1b1916] transition hover:bg-[#f7edd9] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleCreateRoom}
                    disabled={isBusy || !nameInput.trim()}
                  >
                    <Plus className="h-4 w-4" />
                    Create Room
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f2eee6] px-3 py-3 text-[#1b1916] sm:px-6 sm:py-5 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <header className="mb-3 overflow-hidden rounded-lg border border-[#123a30] bg-[#0f3128] text-white shadow-xl shadow-[#3b2d1a]/15 sm:mb-5">
          <div className="flex flex-col gap-4 p-4 sm:gap-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-[#d8b45f] sm:text-sm">Active room</p>
              <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-3">
                <h1 className="text-2xl font-semibold sm:text-4xl">{roomId}</h1>
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm text-[#eee6d6]">
                  {playerName}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:min-w-[420px]">
              <div className="rounded-md border border-white/10 bg-white/10 p-3">
                <p className="text-xs uppercase tracking-wide text-[#d8d0c2]">Players</p>
                <p className="mt-1 text-xl font-semibold sm:text-2xl">{roomPlayers.length}</p>
              </div>
              <div className="rounded-md border border-white/10 bg-white/10 p-3">
                <p className="text-xs uppercase tracking-wide text-[#d8d0c2]">Chips</p>
                <p className="mt-1 text-xl font-semibold sm:text-2xl">{totalChips}</p>
              </div>
              <button
                type="button"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#b94a3a] px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-[#973d31] disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleLeaveRoom}
                disabled={isBusy}
              >
                <LogOut className="h-4 w-4" />
                Leave
              </button>
            </div>
          </div>
        </header>

        <div className="space-y-3 sm:space-y-5">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-[1fr_420px]">
            <section className="rounded-lg border border-[#ded3bf] bg-[#fffaf0] shadow-sm shadow-[#4a3820]/10">
              <div className="flex items-center justify-between border-b border-[#ded3bf] px-4 py-3 sm:px-5 sm:py-4">
                <div>
                  <h2 className="text-lg font-semibold text-[#1b1916]">Players</h2>
                  <p className="text-sm text-[#766d5f]">Live balances.</p>
                </div>
                <Users className="h-5 w-5 text-[#9b917f]" />
              </div>
              {roomPlayers.length > 0 ? (
                <ul className="divide-y divide-[#eee5d5]">
                  {roomPlayers.map((roomPlayer) => (
                    <li key={roomPlayer.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#f1eadc] text-sm font-semibold text-[#4b4438] sm:h-10 sm:w-10">
                          {(roomPlayer.players?.name || roomPlayer.player_id).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-[#1b1916]">
                            {roomPlayer.players?.name || roomPlayer.player_id}
                          </p>
                          {roomPlayer.player_id === playerId && (
                            <p className="text-sm text-[#1f6b4f]">You</p>
                          )}
                        </div>
                      </div>
                      <div className="shrink-0 rounded-md bg-[#fff5d8] px-3 py-2 text-right">
                        <p className="text-base font-semibold leading-none text-[#1b1916] sm:text-lg">{roomPlayer.chips}</p>
                        <p className="text-xs text-[#9a6919]">chips</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-5 text-center text-[#766d5f]">No players in the room.</p>
              )}
            </section>

            <div className="space-y-3 sm:space-y-5">
              <section className="rounded-lg border border-[#ded3bf] bg-[#fffaf0] p-4 shadow-sm shadow-[#4a3820]/10 sm:p-5">
                <div className="mb-4 flex items-center justify-between sm:mb-5">
                  <div>
                    <h2 className="text-lg font-semibold text-[#1b1916]">Transfer chips</h2>
                    <p className="text-sm text-[#766d5f]">
                      Balance available: {currentPlayer?.chips ?? 0}
                    </p>
                  </div>
                  <Send className="h-5 w-5 text-[#9b917f]" />
                </div>
                <div className="space-y-5">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#4b4438]">Send to</label>
                    <select
                      className="min-h-11 w-full rounded-md border border-[#cfc2aa] bg-white px-3 py-2.5 text-base text-[#1b1916] outline-none transition focus:border-[#0f3128] focus:ring-4 focus:ring-[#d8c7a3]"
                      onChange={(event) => setSelectedPlayer(event.target.value)}
                      value={selectedPlayer}
                      disabled={isBusy}
                    >
                      <option value="">Choose a player</option>
                      {otherPlayers.map((roomPlayer) => (
                        <option key={roomPlayer.id} value={roomPlayer.player_id}>
                          {roomPlayer.players?.name || roomPlayer.player_id}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedPlayerData && (
                    <div className="rounded-md border border-[#bfd9c7] bg-[#edf7ef] p-3 sm:p-4">
                      <h3 className="font-semibold text-[#164633]">
                        {selectedPlayerData.players?.name || selectedPlayerData.player_id}
                      </h3>
                      <p className="text-sm text-[#1f6b4f]">
                        Current Balance: {selectedPlayerData.chips} chips
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#4b4438]">Amount</label>
                    <div className="grid grid-cols-4 gap-2">
                      {TRANSFER_AMOUNTS.map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          onClick={() => {
                            setTransferAmount(amount);
                            setCustomTransferAmount(String(amount));
                          }}
                          disabled={isBusy || (currentPlayer ? amount > currentPlayer.chips : true)}
                          className={`min-h-11 rounded-md px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            transferAmount === amount
                              ? "bg-[#0f3128] text-white ring-4 ring-[#d8c7a3]"
                              : "border border-[#cfc2aa] bg-white text-[#2d2923] hover:bg-[#f7edd9]"
                          }`}
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
                      className="mt-3 min-h-11 w-full rounded-md border border-[#cfc2aa] bg-white px-3 py-2.5 text-base text-[#1b1916] outline-none transition focus:border-[#0f3128] focus:ring-4 focus:ring-[#d8c7a3]"
                      disabled={isBusy}
                    />
                  </div>

                  <button
                    type="button"
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-[#0f3128] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#174338] disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleChipTransfer}
                    disabled={isBusy || !selectedPlayer || isTransferAmountInvalid}
                  >
                    <Send className="h-4 w-4" />
                    Transfer {transferAmount ?? 0} Chips
                  </button>
                </div>
              </section>

              <section className="rounded-lg border border-[#ded3bf] bg-[#fffaf0] shadow-sm shadow-[#4a3820]/10">
                <div className="border-b border-[#ded3bf] px-4 py-3 sm:px-5 sm:py-4">
                  <h2 className="text-lg font-semibold text-[#1b1916]">Recent transactions</h2>
                </div>
                {transactions.length > 0 ? (
                  <ul className="max-h-96 divide-y divide-[#eee5d5] overflow-y-auto">
                    {transactions.map((transaction) => (
                      <li key={transaction.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
                        <span className="min-w-0 truncate text-sm text-[#4b4438]">
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
                        <span className="whitespace-nowrap rounded-md bg-[#f1eadc] px-2 py-1 text-sm font-semibold text-[#1b1916]">
                          {transaction.amount}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="p-5 text-center text-[#766d5f]">No transactions yet.</p>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
};

export default ChipTracker;
