import supabase from "./supabaseClient";
import type { RoomPlayer, Transaction } from "@/types";

const STARTING_CHIPS = 1000;
const ROOM_ID_LENGTH = 6;
const MAX_ROOM_ID_ATTEMPTS = 5;

const generateRoomId = () => Math.random().toString(36).slice(2, 2 + ROOM_ID_LENGTH);

export const ensurePlayer = async (playerId: string, playerName: string) => {
  const { error } = await supabase.from("players").upsert({
    id: playerId,
    name: playerName.trim(),
  });

  if (error) throw error;
};

export const getRoom = async (roomId: string) => {
  const { data, error } = await supabase.from("rooms").select("id").eq("id", roomId).maybeSingle();

  if (error) throw error;
  return data;
};

export const joinRoom = async (roomId: string, playerId: string, playerName: string) => {
  await ensurePlayer(playerId, playerName);

  const { data: existingMembership, error: membershipReadError } = await supabase
    .from("room_players")
    .select("id")
    .eq("room_id", roomId)
    .eq("player_id", playerId)
    .maybeSingle();

  if (membershipReadError) throw membershipReadError;
  if (existingMembership) return;

  const { error } = await supabase.from("room_players").insert({
    player_id: playerId,
    room_id: roomId,
    chips: STARTING_CHIPS,
  });

  if (error) throw error;
};

export const createRoomAndJoin = async (playerId: string, playerName: string) => {
  await ensurePlayer(playerId, playerName);

  for (let attempt = 0; attempt < MAX_ROOM_ID_ATTEMPTS; attempt += 1) {
    const roomId = generateRoomId();
    const { error: roomError } = await supabase.from("rooms").insert({ id: roomId });

    if (roomError) {
      if (roomError.code === "23505") continue;
      throw roomError;
    }

    await joinRoom(roomId, playerId, playerName);
    return roomId;
  }

  throw new Error("Could not create a unique room code. Please try again.");
};

export const leaveRoom = async (roomId: string, playerId: string) => {
  const { error } = await supabase
    .from("room_players")
    .delete()
    .match({ room_id: roomId, player_id: playerId });

  if (error) throw error;
};

export const renamePlayer = async (playerId: string, playerName: string) => {
  const { error } = await supabase.from("players").update({ name: playerName.trim() }).eq("id", playerId);

  if (error) throw error;
};

export const fetchRoomPlayers = async (roomId: string) => {
  const { data, error } = await supabase
    .from("room_players")
    .select("*, players ( name )")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as RoomPlayer[];
};

export const fetchTransactions = async (roomId: string) => {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("room_id", roomId)
    .order("timestamp", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Transaction[];
};

export const transferChips = async (
  roomId: string,
  fromPlayerId: string,
  toPlayerId: string,
  amount: number
) => {
  const { error } = await supabase.rpc("transfer_chips", {
    p_room_id: roomId,
    p_from_player: fromPlayerId,
    p_to_player: toPlayerId,
    p_amount: amount,
  });

  if (error) throw error;
};
