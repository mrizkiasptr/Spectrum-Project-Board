/* Supabase project for the SPEctrum Sprint Board.
   The publishable key is meant to ship to the browser: every read and write is
   still checked by Row Level Security on public.spectrum_board_state (signed-in users only). */
window.SPX_CONFIG = {
  url: "https://uomajehbtzzaxkygecam.supabase.co",
  key: "sb_publishable_hU0F_g9LQNqoG7du3tlQYA_pBagSTR6",
  table: "spectrum_board_state",
  /* Set true once the Azure (Microsoft) provider is enabled in Supabase Authentication → Providers. */
  microsoft: false
};
