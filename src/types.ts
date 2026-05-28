export interface Player {
  id: string;
  name: string;
  created_at?: string;
}

export interface Room {
  id: string;
  created_at?: string;
}

export interface RoomPlayer {
  id: string;
  player_id: string;
  room_id: string;
  chips: number;
  joined_at?: string;
  players?: { name: string };
}

export interface Transaction {
  id: string;
  room_id: string;
  from_player: string;
  to_player: string;
  from_player_name?: string | null;
  to_player_name?: string | null;
  amount: number;
  timestamp?: string;
}
