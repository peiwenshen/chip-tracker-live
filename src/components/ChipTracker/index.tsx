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
      <main className="min-h-screen bg-[#f6f3ee] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center">
          <div className="grid w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl lg:grid-cols-[1.05fr_0.95fr]">
            <section className="flex flex-col justify-between bg-slate-950 p-6 text-white sm:p-8 lg:p-10">
              <div>
                <div className="mb-10 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm text-slate-200">
                  <CircleDollarSign className="h-4 w-4 text-emerald-300" />
                  Live table balance
                </div>
                <h1 className="max-w-xl text-4xl font-semibold leading-tight sm:text-5xl">
                  Poker Chip Tracker
                </h1>
                <p className="mt-5 max-w-md text-base text-slate-300">
                  Create a room, invite players, and keep chip transfers synced during the game.
                </p>
              </div>

              <div className="mt-12 grid grid-cols-3 gap-3 text-sm text-slate-300">
                <div className="rounded-md border border-white/10 bg-white/10 p-4">
                  <p className="text-2xl font-semibold text-white">1,000</p>
                  <p>Starting chips</p>
                </div>
                <div className="rounded-md border border-white/10 bg-white/10 p-4">
                  <p className="text-2xl font-semibold text-white">Live</p>
                  <p>Room updates</p>
                </div>
                <div className="rounded-md border border-white/10 bg-white/10 p-4">
                  <p className="text-2xl font-semibold text-white">RPC</p>
                  <p>Safe transfers</p>
                </div>
              </div>
            </section>

            <section className="p-6 sm:p-8 lg:p-10">
              <div className="mb-8">
                <h2 className="text-2xl font-semibold text-slate-950">Join a table</h2>
                <p className="mt-2 text-sm text-slate-500">Use a player name and room code, or create a new room.</p>
              </div>

              {error && (
                <div className="mb-5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </div>
              )}

              {successMessage && (
                <div className="mb-5 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
                  {successMessage}
                </div>
              )}

              <div className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Player name</label>
                  <input
                    value={nameInput}
                    onChange={(event) => setNameInput(event.target.value)}
                    placeholder="e.g. Alex"
                    className="w-full rounded-md border border-slate-300 bg-white p-3 text-slate-950 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200"
                  />
                </div>

                <button
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={handleSaveName}
                  disabled={isBusy || !nameInput.trim()}
                >
                  <Users className="h-4 w-4" />
                  Save Name
                </button>

                <div className="pt-3">
                  <label className="mb-2 block text-sm font-medium text-slate-700">Room code</label>
                  <input
                    value={roomInput}
                    onChange={(event) => setRoomInput(event.target.value)}
                    placeholder="Enter room code"
                    className="w-full rounded-md border border-slate-300 bg-white p-3 text-slate-950 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200"
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleJoinRoom}
                    disabled={isBusy || !nameInput.trim() || !roomInput.trim()}
                  >
                    <DoorOpen className="h-4 w-4" />
                    Join Room
                  </button>
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
    <main className="min-h-screen bg-[#f6f3ee] px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <header className="mb-5 overflow-hidden rounded-lg border border-slate-200 bg-slate-950 text-white shadow-lg">
          <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-emerald-300">Active room</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-semibold sm:text-4xl">{roomId}</h1>
                <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-sm text-slate-200">
                  {playerName}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:min-w-[420px]">
              <div className="rounded-md border border-white/10 bg-white/10 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Players</p>
                <p className="mt-1 text-2xl font-semibold">{roomPlayers.length}</p>
              </div>
              <div className="rounded-md border border-white/10 bg-white/10 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Total chips</p>
                <p className="mt-1 text-2xl font-semibold">{totalChips}</p>
              </div>
              <button
                type="button"
                className="col-span-2 inline-flex items-center justify-center gap-2 rounded-md bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 sm:col-span-1"
                onClick={handleLeaveRoom}
                disabled={isBusy}
              >
                <LogOut className="h-4 w-4" />
                Leave
              </button>
            </div>
          </div>
        </header>

        <div className="space-y-5">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_420px]">
            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Players</h2>
                  <p className="text-sm text-slate-500">Balances update when transfers land.</p>
                </div>
                <Users className="h-5 w-5 text-slate-400" />
              </div>
              {roomPlayers.length > 0 ? (
                <ul className="divide-y divide-slate-100">
                  {roomPlayers.map((roomPlayer) => (
                    <li key={roomPlayer.id} className="flex items-center justify-between gap-4 px-5 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-sm font-semibold text-slate-700">
                          {(roomPlayer.players?.name || roomPlayer.player_id).slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-900">
                            {roomPlayer.players?.name || roomPlayer.player_id}
                          </p>
                          {roomPlayer.player_id === playerId && (
                            <p className="text-sm text-emerald-700">You</p>
                          )}
                        </div>
                      </div>
                      <div className="rounded-md bg-amber-50 px-3 py-2 text-right">
                        <p className="text-lg font-semibold leading-none text-slate-950">{roomPlayer.chips}</p>
                        <p className="text-xs text-amber-700">chips</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="p-5 text-center text-slate-500">No players in the room.</p>
              )}
            </section>

            <div className="space-y-5">
              <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Transfer chips</h2>
                    <p className="text-sm text-slate-500">
                      Balance available: {currentPlayer?.chips ?? 0}
                    </p>
                  </div>
                  <Send className="h-5 w-5 text-slate-400" />
                </div>
                <div className="space-y-5">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Send to</label>
                    <select
                      className="w-full rounded-md border border-slate-300 bg-white p-3 text-slate-950 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200"
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
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
                      <h3 className="font-semibold text-emerald-900">
                        {selectedPlayerData.players?.name || selectedPlayerData.player_id}
                      </h3>
                      <p className="text-sm text-emerald-700">
                        Current Balance: {selectedPlayerData.chips} chips
                      </p>
                    </div>
                  )}

                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700">Amount</label>
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
                          className={`rounded-md px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            transferAmount === amount
                              ? "bg-slate-950 text-white ring-4 ring-slate-200"
                              : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
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
                      className="mt-3 w-full rounded-md border border-slate-300 bg-white p-3 text-slate-950 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200"
                      disabled={isBusy}
                    />
                  </div>

                  <button
                    type="button"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                    onClick={handleChipTransfer}
                    disabled={isBusy || !selectedPlayer || isTransferAmountInvalid}
                  >
                    <Send className="h-4 w-4" />
                    Transfer {transferAmount ?? 0} Chips
                  </button>
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-5 py-4">
                  <h2 className="text-lg font-semibold text-slate-950">Recent transactions</h2>
                </div>
                {transactions.length > 0 ? (
                  <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
                    {transactions.map((transaction) => (
                      <li key={transaction.id} className="flex items-center justify-between gap-4 px-5 py-3">
                        <span className="min-w-0 text-sm text-slate-700">
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
                        <span className="whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 text-sm font-semibold text-slate-950">
                          {transaction.amount}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="p-5 text-center text-slate-500">No transactions yet.</p>
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
