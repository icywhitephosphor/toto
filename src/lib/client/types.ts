// Wire types for the browser client (mirror of the 06 API shapes).

export interface ApiUser {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  is_admin: boolean;
}

export interface ApiParticipant {
  id: string;
  roster_no: number;
  display_name: string;
  status: string;
}

export interface ApiTournament {
  id: string;
  name: string;
  display_tz: string;
  bonus_deadline_at: string;
  match_deadline_lead: string;
  starts_at: string | null;
  ends_at: string | null;
}

export interface ApiDeadlines {
  bonus_locked: boolean;
  bonus_deadline_at: string;
  next_match_deadline_at: string | null;
  next_match_id: string | null;
}

export interface Bootstrap {
  server_time: string;
  user: ApiUser | null;
  participant: ApiParticipant | null;
  tournament: ApiTournament;
  deadlines: ApiDeadlines;
}

export interface ApiTeam {
  id: string;
  code: string | null;
  name_ru: string | null;
  name_en: string | null;
  logo_url: string | null;
}

export interface ApiResult {
  result_status: string;
  base_home: number | null;
  base_away: number | null;
  pen_home: number | null;
  pen_away: number | null;
  toto_home: number | null;
  toto_away: number | null;
  winner_team_id: string | null;
  confirmed: boolean;
  source: string;
}

export type Stage = "GROUP" | "R32" | "R16" | "QF" | "SF" | "THIRD" | "FINAL";

export interface ApiMatch {
  id: string;
  fifa_match_no: number;
  stage: Stage;
  group_code: string | null;
  home_team: ApiTeam | null;
  away_team: ApiTeam | null;
  home_slot: string | null;
  away_slot: string | null;
  kickoff_at: string | null;
  deadline_at: string | null;
  venue: string | null;
  city: string | null;
  status: string;
  x2_allowed: boolean;
  result: ApiResult | null;
  /** Who currently holds an unresolved knockout slot (live group tables). */
  projected_home?: ApiTeam | null;
  projected_away?: ApiTeam | null;
}

export interface MyBet {
  pred_home: number;
  pred_away: number;
  x2: boolean;
  pen_winner: "HOME" | "AWAY" | null;
  submitted_at: string;
  updated_at: string;
  version: number;
  /** Points earned for this match, null until the result is scored. */
  points?: number | null;
}

export interface LeaderboardRow {
  place: number;
  participant_id: string;
  display_name: string;
  total_points: number;
  match_points: number;
  bonus_points: number;
  playoff_match_points: number;
  key_bonus_points: number;
  tiebreak_rank: number | null;
  bonus_breakdown: Record<string, number | null>;
  prize: { place: number; amount: number; label: string } | null;
}

export interface Leaderboard {
  server_time: string;
  generated_at: string | null;
  reason: string | null;
  rows: LeaderboardRow[];
}

export interface BonusItem {
  team_id?: string;
  code?: string | null;
  name_ru?: string | null;
  player_name?: string | null;
}

export interface MyBonusBet {
  category_id: string;
  items: BonusItem[];
  submitted_at: string;
  updated_at: string;
}
