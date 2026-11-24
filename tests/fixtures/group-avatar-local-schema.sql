-- Synthetic dependency schema only, for the disposable real-Auth integration.
-- Not a production migration or a complete reproduction of production RLS.
CREATE TABLE public.player_profiles(
 id uuid PRIMARY KEY, linked_auth_user_id uuid REFERENCES auth.users(id),
 display_name text NOT NULL, is_active boolean NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX synthetic_one_active_profile ON public.player_profiles(linked_auth_user_id)
 WHERE linked_auth_user_id IS NOT NULL AND is_active;
CREATE TABLE public.clubs(id uuid PRIMARY KEY,owner_id uuid,name text,is_active boolean DEFAULT true,is_deleted boolean DEFAULT false,visibility text);
CREATE TABLE public.club_members(id uuid PRIMARY KEY,club_id uuid REFERENCES public.clubs(id),player_profile_id uuid REFERENCES public.player_profiles(id),profile_id uuid,is_active boolean DEFAULT true,role text);
CREATE TABLE public.padel_facilities(id uuid PRIMARY KEY,name text,prefecture text,aliases text[],availability text,usage_note text);
-- Existing 0049 defines a history read RPC; these empty dependencies are never exercised.
CREATE TABLE public.events(id uuid,club_id uuid,event_mode text,created_at timestamptz,created_by_auth_user_id uuid,is_deleted boolean);
CREATE TABLE public.event_participants(id uuid,event_id uuid,participant_type text,player_profile_id uuid,profile_id uuid,status text);
CREATE TABLE public.match_players(participant_id uuid);
CREATE TABLE public.event_team_matches(event_id uuid,team_a_player1_profile_id uuid,team_a_player2_profile_id uuid,team_b_player1_profile_id uuid,team_b_player2_profile_id uuid);
CREATE TABLE public.event_team_rounds(event_id uuid,eligible jsonb);
CREATE TABLE public.event_team_attendance(event_id uuid,status text,member_id uuid);
CREATE TABLE public.event_team_sides(event_id uuid,club_id uuid);
CREATE TABLE public.official_events(id uuid,club_id uuid,created_at timestamptz,created_by_auth_user_id uuid,is_deleted boolean);
CREATE TABLE public.official_opponents(id uuid,official_event_id uuid);
CREATE TABLE public.official_matches(official_opponent_id uuid,our_player1_profile_id uuid,our_player2_profile_id uuid);
GRANT SELECT ON public.player_profiles,public.padel_facilities TO authenticated;
CREATE SCHEMA group_read_private;
REVOKE ALL ON SCHEMA group_read_private FROM PUBLIC,anon,authenticated;
