# SPEctrum Sprint Board

Interactive prototype of SPEctrum V2 (sprint board, backlog, planning, capacity, time logging, reports, RBAC settings), built on the SPE Nova design system. It is a static site with no build step.

## Files

| File | What it does |
| --- | --- |
| `spectrum-sprint.html` | The whole app: layout, styles, seed data and logic |
| `supabase-config.js` | Supabase project URL and publishable key |
| `supabase-sync.js` | Sign-in screens (split layout from the Figma login page), loading/saving the board's data, realtime updates |
| `supabase/migrations/` | SQL for the `spectrum_board_state` table (already applied) |
| `supabase/functions/signup/` | Edge Function behind "Create an account" (deployed, `verify_jwt` off because it runs before sign-in) |
| `vercel.json` | Serves `spectrum-sprint.html` at `/` |

## How data is stored

The app keeps its data in in-memory stores (`tasks`, `BACKLOG`, `SPR`, `INVENTORY`, `LABELS`, RBAC tables, …). Each store is one row in `public.spectrum_board_state`:

- **On sign-in** the rows replace the built-in seed data. On an empty table, the seed data is saved as the starting point.
- **On every change** only the stores that actually changed are written (checked shortly after each click/input, and every 5 s).
- **Other people's changes** arrive over Supabase Realtime and re-render the board. They wait until you leave the field you're typing in.
- **Conflicts:** last write wins per store. If two people edit the same store at the same moment, the later save keeps its version.

The dot next to your email in the sidebar shows the save state: green = saved, amber = saving, red = couldn't save (it retries).

Not saved, on purpose: UI state (open tabs, filters, drawers), the role switcher ("viewing as"), running timers and a sprint draft that hasn't been launched yet.

To start over from the seed data, delete the rows: `delete from public.spectrum_board_state;`

## Access

Only signed-in users can read or write (Row Level Security; the `anon` role has no access). People create an account with email + password on the sign-in screen and are signed in straight away: "Create an account" calls the `signup` Edge Function (`supabase/functions/signup`), which creates the user already confirmed with the service-role key, so no confirmation email is sent. The sign-in screen follows the Figma login page (Spectrum V.2): brand and form on the left, a product preview on the right (hidden below 1100px). "Sign in with Microsoft" is in the layout but off until the Azure provider is enabled in Supabase and `microsoft: true` is set in `supabase-config.js`; until then it tells people to use email and password. "Reset your password" emails a reset link that opens the app on a "Set a new password" screen.

After the first sign-in, each person picks which team member they are (or adds themselves to the team). That member becomes "me" in the app: My Task, the timer, "assigned to me" and new tasks/backlog items use it, and the role switcher starts at the matching Job Position (FE → Frontend Developer, SE → Backend Developer, QA → QA Engineer). The links are kept in the `MEMBER_CLAIMS` row; a member already linked to another account can't be picked. To re-link someone, remove their entry from that row.

## Deploy to Vercel

1. In Vercel, **Add New → Project**, import this GitHub repo.
2. Framework preset: **Other**. Leave the build command and output directory empty.
3. Deploy. The board is served at `/`.

Production: https://spectrum-spe.vercel.app (Vercel project `spectrum-project-board`, deploys from `main`). The older https://spectrum-project-board.vercel.app address still works.

Then in Supabase (**Authentication → URL Configuration**) set **Site URL** to the Vercel domain and add it to **Redirect URLs**, so email-confirmation and password-reset links open the deployed app.

## Run locally

Any static server works, e.g. `npx serve .`, then open the printed URL. Opening the HTML file straight from disk (`file://`) still signs in, but email-confirmation links won't return to it.
