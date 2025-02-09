"use client";

import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import supabase from "@/lib/supabaseClient";
import type { RoomPlayer, Transaction } from "@/types";

const ChipTracker = () => {
  // Generate a persistent player ID
  const [playerId] = useState(() => {
    const storedId = localStorage.getItem("playerId");
    if (storedId) return storedId;
    const newId = uuidv4();
    localStorage.setItem("playerId", newId);
    return newId;
  });

  // Persist player name and room info across reloads
  const [tempPlayerName, setTempPlayerName] = useState("");
  const [playerName, setPlayerName] = useState(localStorage.getItem("playerName") || "");
  const [roomId, setRoomId] = useState(localStorage.getItem("roomId") || "");
  const [hasJoinedRoom, setHasJoinedRoom] = useState(!!localStorage.getItem("roomId"));

  // Data arrays
  const [roomPlayers, setRoomPlayers] = useState<RoomPlayer[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // For chip transfers
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [selectedPlayerData, setSelectedPlayerData] = useState<RoomPlayer | null>(null);
  const [transferAmount, setTransferAmount] = useState<number | null>(null);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // New state for rename functionality
  const [newPlayerName, setNewPlayerName] = useState("");
  const [renameSuccess, setRenameSuccess] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);

  // Persist player name changes
  useEffect(() => {
    if (playerName) localStorage.setItem("playerName", playerName);
  }, [playerName]);

  // Debug: log roomPlayers updates
  useEffect(() => {
    console.log("Updated roomPlayers:", roomPlayers);
  }, [roomPlayers]);

    // Add new rename handler
    const handleRename = async () => {
        if (!newPlayerName || !playerId) return;
        setError(null);
        try {
        // Update player record in database
        const { error: playerError } = await supabase
            .from("players")
            .update({ name: newPlayerName })
            .eq("id", playerId);

        if (playerError) throw playerError;

        // Update local state and storage
        setPlayerName(newPlayerName);
        localStorage.setItem("playerName", newPlayerName);
        setNewPlayerName("");
        setRenameSuccess(true);

        // Clear success message after 3 seconds
        setTimeout(() => {
            setRenameSuccess(false);
        }, 3000);
        } catch (err: any) {
        console.error("Error renaming player:", err);
        setError("Error renaming player: " + (err.message || err));
        }
    };


  // Fetch room players (with join query to include player's name)
  const fetchRoomPlayers = async () => {
    if (!roomId) return;
    setError(null);
    const { data, error } = await supabase
      .from("room_players")
      .select(`*, players ( name )`)
      .eq("room_id", roomId);
    if (error) {
      console.error("Error fetching room players:", error);
      setError("Error fetching room players: " + error.message);
    } else {
      setRoomPlayers(data);
    }
  };

  // Fetch transactions for the room
  const fetchTransactions = async () => {
    if (!roomId) return;
    setError(null);
    const { data, error } = await supabase
      .from("transactions")
      .select("*")
      .eq("room_id", roomId);
    if (error) {
      console.error("Error fetching transactions:", error);
      setError("Error fetching transactions: " + error.message);
    } else {
      setTransactions(data);
    }
  };

  // Refetch data when roomId changes
  useEffect(() => {
    if (roomId) {
      fetchRoomPlayers();
      fetchTransactions();
    }
  }, [roomId]);

  // Realtime subscriptions for room_players and transactions
  useEffect(() => {
    if (!roomId) return;

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
          fetchRoomPlayers();
        }
      )
      .subscribe();

    const transactionChannel = supabase
      .channel(`transactions_${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "transactions",
          filter: `room_id=eq.${roomId}`,
        },
        () => {
          fetchTransactions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(roomChannel);
      supabase.removeChannel(transactionChannel);
    };
  }, [roomId]);

  // Fetch selected player's data when selection changes
  useEffect(() => {
    if (!selectedPlayer || !roomId) {
      setSelectedPlayerData(null);
      return;
    }
    const fetchPlayerData = async () => {
      setError(null);
      const { data, error } = await supabase
        .from("room_players")
        .select(`*, players ( name )`)
        .eq("room_id", roomId)
        .eq("player_id", selectedPlayer)
        .single();
      if (error) {
        console.error("Error fetching selected player data:", error);
        setError("Error fetching selected player data: " + error.message);
      } else {
        setSelectedPlayerData(data);
      }
    };
    fetchPlayerData();
  }, [selectedPlayer, roomId]);

  // Handle leaving the room
  const handleLeaveRoom = async () => {
    if (!roomId || !playerId) return;
    setError(null);
    try {
      const { error } = await supabase
        .from("room_players")
        .delete()
        .match({ room_id: roomId, player_id: playerId });
      if (error) throw error;
      await supabase.removeAllChannels();
      setRoomId("");
      setRoomPlayers([]);
      setTransactions([]);
      setSelectedPlayer(null);
      setSelectedPlayerData(null);
      setTransferAmount(null);
      setHasJoinedRoom(false);
      localStorage.removeItem("roomId");
      window.location.reload();
    } catch (err: any) {
      console.error("Error leaving room:", err);
      setError("Error leaving room: " + (err.message || err));
    }
  };

  // Handle joining a room
  const handleJoinRoom = async () => {
    if (!roomId || !playerName) return;
    setError(null);
    try {
      // Check if the room exists
      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("*")
        .eq("id", roomId)
        .single();
      if (roomError || !roomData) {
        setError("Room not found. Please check the room code or create a new room.");
        return;
      }

      // Upsert player record
      const { error: playerError } = await supabase.from("players").upsert({
        id: playerId,
        name: playerName,
      });
      if (playerError) throw playerError;

      // Upsert room_player record with default chips
      const { error: roomPlayerError } = await supabase.from("room_players").upsert({
        player_id: playerId,
        room_id: roomId,
        chips: 1000,
      });
      if (roomPlayerError) throw roomPlayerError;

      localStorage.setItem("roomId", roomId);
      setHasJoinedRoom(true);
      fetchRoomPlayers();
    } catch (err: any) {
      console.error("Error joining room:", err);
      setError("Error joining room: " + (err.message || err));
    }
  };

  // Handle creating a new room
  const handleCreateRoom = async () => {
    setError(null);
    try {
      setIsCreatingRoom(true);
      const newRoomId = Math.random().toString(36).substring(2, 8);
      const { error } = await supabase.from("rooms").insert([{ id: newRoomId }]);
      if (error) {
        setIsCreatingRoom(false);
        throw error;
      }
      setRoomId(newRoomId);
      localStorage.setItem("roomId", newRoomId);
      setIsCreatingRoom(false);
    } catch (err: any) {
      console.error("Error creating room:", err);
      setError("Error creating room: " + (err.message || err));
      setIsCreatingRoom(false);
    }
  };

  // Handle chip transfer: create transaction and update chip counts
  const handleChipTransfer = async () => {
    if (!selectedPlayer || !transferAmount) return;
    setError(null);
    try {
      // Insert a transaction record
      const { error: txnError } = await supabase.from("transactions").insert({
        room_id: roomId,
        from_player: playerId,
        to_player: selectedPlayer,
        amount: transferAmount,
      });
      if (txnError) throw txnError;

      // Update chip counts for sender and receiver
      const senderRecord = roomPlayers.find((rp) => rp.player_id === playerId);
      const receiverRecord = roomPlayers.find((rp) => rp.player_id === selectedPlayer);
      if (!senderRecord || !receiverRecord) {
        throw new Error("Could not find sender or receiver record.");
      }
      const newSenderChips = senderRecord.chips - transferAmount;
      const newReceiverChips = receiverRecord.chips + transferAmount;

      const { error: updateSenderError } = await supabase
        .from("room_players")
        .update({ chips: newSenderChips })
        .eq("player_id", playerId)
        .eq("room_id", roomId);
      if (updateSenderError) throw updateSenderError;

      const { error: updateReceiverError } = await supabase
        .from("room_players")
        .update({ chips: newReceiverChips })
        .eq("player_id", selectedPlayer)
        .eq("room_id", roomId);
      if (updateReceiverError) throw updateReceiverError;

      // Refetch updated data
      await fetchRoomPlayers();
      await fetchTransactions();
      setTransferAmount(null);
      setSelectedPlayer(null);
    } catch (err: any) {
      console.error("Error transferring chips:", err);
      setError("Error transferring chips: " + (err.message || err));
    }
  };

  // --- RENDERING ---

  // If the player hasn't set a name or joined a room, render the join screen
  if (!playerName || !hasJoinedRoom) {
    return (
      <div className="w-full px-4 sm:px-6 md:px-8 mx-auto max-w-xl">
        <div className="w-full max-w-md backdrop-blur-lg bg-white/95 shadow-2xl">
          {/* Header */}
          <div className="bg-blue-600 text-white space-y-2 p-6 rounded-t-lg">
            <h2 className="text-2xl sm:text-3xl font-bold text-center">Poker Chip Tracker</h2>
          </div>
          {/* Content */}
          <div className="p-6 space-y-8">
            {error && (
              <div className="text-red-500 text-center bg-red-50 p-3 rounded-lg border border-red-200">
                {error}
              </div>
            )}
            {/* Set Player Name */}
            {!playerName && (
              <div className="space-y-4">
                <input
                  value={tempPlayerName}
                  onChange={(e) => setTempPlayerName(e.target.value)}
                  placeholder="Your name"
                  className="w-full border p-2 rounded-md"
                />
                <button
                  className="w-full bg-blue-600 text-white py-2 rounded-md"
                  onClick={() => {
                    setPlayerName(tempPlayerName);
                    localStorage.setItem("playerName", tempPlayerName);
                  }}
                >
                  Set Name
                </button>
              </div>
            )}
            {/* Rename */}
            {playerName && (
              <div className="space-y-4">
                <input
                  value={newPlayerName}
                  onChange={(e) => setNewPlayerName(e.target.value)}
                  placeholder="New name"
                  className="w-full border p-2 rounded-md"
                />
                <button className="w-full bg-blue-600 text-white py-2 rounded-md" onClick={handleRename}>
                  Rename
                </button>
                {renameSuccess && <p className="text-green-600 text-sm">Name updated successfully!</p>}
              </div>
            )}
            {/* Join/Create Room */}
            <input
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              placeholder="Room code"
              className="w-full border p-2 rounded-md"
            />
            <button className="w-full bg-green-600 text-white py-2 rounded-md" onClick={handleJoinRoom}>
              Join Room
            </button>
            <button className="w-full bg-green-700 text-white py-2 rounded-md" onClick={handleCreateRoom}>
              Create New Room
            </button>
          </div>
        </div>
      </div>
    );
  }

// Main room interface
return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-4 sm:p-6">
      <div className="w-full max-w-4xl mx-auto shadow-xl">
        {/* Header */}
        <div className="bg-gray-800 text-white flex flex-col sm:flex-row justify-between items-center gap-4 p-6 rounded-t-lg">
          <div className="space-y-2 text-center sm:text-left">
            <h2 className="text-xl sm:text-2xl font-bold">Room: {roomId}</h2>
            <p className="text-gray-300 text-sm">Welcome, {playerName}</p>
          </div>
          <button
            type="button"
            className="bg-red-600 hover:bg-red-700 transition-colors text-white py-2 px-4"
            onClick={handleLeaveRoom}
          >
            Leave Room
          </button>
        </div>
  
        {/* Content */}
        <div className="p-6 space-y-10">
          {error && (
            <div className="text-red-500 text-center bg-red-50 p-3 rounded-lg border border-red-200">
              {error}
            </div>
          )}
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column: Players */}
            <div className="space-y-8">
              {/* Players List */}
              <section className="bg-white rounded-lg p-6 shadow-md">
                <h2 className="text-xl font-semibold mb-4 text-gray-800">Players</h2>
                {roomPlayers.length > 0 ? (
                  <ul className="divide-y divide-gray-200">
                    {roomPlayers.map((rp) => (
                      <li key={rp.id} className="flex justify-between items-center py-3">
                        <span className="font-medium text-gray-800">
                          {rp.players?.name || rp.player_id}
                          {rp.player_id === playerId && (
                            <span className="ml-2 text-sm text-blue-600">(You)</span>
                          )}
                        </span>
                        <span className="font-bold text-gray-900">{rp.chips} chips</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-gray-500 text-center">No players in the room.</p>
                )}
              </section>
            </div>
  
            {/* Right Column: Transfer Chips & Transactions */}
            <div className="space-y-8">
              {/* Transfer Chips */}
              <section className="bg-white rounded-lg p-6 shadow-md">
                <h2 className="text-xl font-semibold mb-6 text-gray-800">Transfer Chips</h2>
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Select Player
                    </label>
                    <select
                      className="w-full border border-gray-300 rounded-lg p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      onChange={(e) => setSelectedPlayer(e.target.value)}
                      value={selectedPlayer || ""}
                    >
                      <option value="">Choose a player</option>
                      {roomPlayers
                        .filter((rp) => rp.player_id !== playerId)
                        .map((rp) => (
                          <option key={rp.id} value={rp.player_id}>
                            {rp.players?.name || rp.player_id}
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Amount
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[10, 20, 50, 100].map((amount) => (
                        <button
                          key={amount}
                          type="button"
                          onClick={() => setTransferAmount(amount)}
                          className={`py-2 px-4 transition-colors ${
                            transferAmount === amount
                              ? "bg-blue-700 ring-2 ring-blue-300"
                              : "bg-blue-500 hover:bg-blue-600"
                          } text-white`}
                        >
                          {amount}
                        </button>
                      ))}
                    </div>
                  </div>
  
                  <button
                    type="button"
                    className="w-full bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 text-white py-2"
                    onClick={handleChipTransfer}
                    disabled={!selectedPlayer || !transferAmount}
                  >
                    Transfer {transferAmount} Chips
                  </button>
                </div>
              </section>
  
              {/* Recent Transactions - Moved Below Transfer Chips */}
              <section className="bg-white rounded-lg p-6 shadow-md">
                <h2 className="text-xl font-semibold mb-4 text-gray-800">Recent Transactions</h2>
                {transactions.length > 0 ? (
                  <ul className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
                    {transactions.map((txn) => {
                      const fromName =
                        roomPlayers.find((rp) => rp.player_id === txn.from_player)?.players?.name ||
                        txn.from_player;
                      const toName =
                        roomPlayers.find((rp) => rp.player_id === txn.to_player)?.players?.name ||
                        txn.to_player;
                      return (
                        <li key={txn.id} className="py-3 flex justify-between items-center">
                          <span className="text-gray-800">
                            <span className="font-medium">{fromName}</span>
                            <span className="mx-2">→</span>
                            <span className="font-medium">{toName}</span>
                          </span>
                          <span className="font-bold text-gray-900">{txn.amount} chips</span>
                        </li>
                      );
                    })}
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