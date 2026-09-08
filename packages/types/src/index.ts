export type UserRole = 'player' | 'arena_owner' | 'admin';

export type ReservationStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';

export type ReservationSource = 'app' | 'arena_manual' | 'whatsapp' | 'admin';

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface Arena {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string;
  city: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  logo_path: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ArenaOwner {
  arena_id: string;
  user_id: string;
  created_at: string;
}

export interface Sport {
  id: number;
  name: string;
  slug: string;
}

export interface Court {
  id: string;
  arena_id: string;
  name: string;
  description: string | null;
  active: boolean;
  default_duration_minutes: number;
  sports: Sport[];
  created_at: string;
  updated_at: string;
}

export interface OpeningHour {
  id: string;
  arena_id: string;
  weekday: number;
  open_time: string;
  close_time: string;
  active: boolean;
}

export interface PricingRule {
  id: string;
  court_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  price: string;
  active: boolean;
}

export interface HealthResponse {
  status: 'ok';
  service: 'playarena-api';
}
