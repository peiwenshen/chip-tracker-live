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
    
    /**
     * This field does not exist in the actual "room_players" table schema.
     * However, when querying with `.select("*, players ( name )")`, 
     * Supabase joins the "players" table, adding the `name` field from "players".
     * 
     * Since TypeScript does not automatically infer this, we add `players?: { name: string }`
     * to prevent errors when accessing `rp.players?.name` in our React components.
     * 
     * Note: The `?` makes it optional because not every query includes this join.
     */
    players?: { name: string }; // ✅ This represents the joined "players" data
  }
  
  export interface Transaction {
    id: string;
    room_id: string;
    from_player: string;
    to_player: string;
    amount: number;
    timestamp?: string;
  }