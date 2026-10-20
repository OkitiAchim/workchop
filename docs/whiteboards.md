# Shared whiteboards

Click a whiteboard in play mode to open its live view. Members, admins and owners can choose **Take control**. One person edits each board at a time; different boards have independent editing turns. Ordinary office guests watch. Support customers cannot open or receive board content.

Use Pen, Eraser (removes a selected object/stroke), Text, Note, Table, Rectangle, Circle, Line or Arrow. Select an object to move, resize or rotate it; text and table cells are edited in the side inspector. Existing content stays editable after another member takes control. Ink, fill, text size and stroke width can be changed. Pan and mouse-wheel zoom work in the enlarged view; Fit board resets the view. Touch dragging supports drawing, selection and panning.

The white editor page has the same fixed 16:9 aspect ratio as the board surface in the office. The gray surroundings are outside the board. A dashed guide marks the fixed inner margin; moving, resizing, rotating, importing and drawing keep content inside that margin in both views. Oversized or previously off-board objects are fitted back inside without discarding their content. Tall diagrams retain their aspect ratio when imported.

Taking control or reopening restores the saved arrangement, including existing text, tables, notes and images. Notes and text start empty with a typing hint in the inspector; the hint is not saved as board content. Legacy default text is selected on focus so typing replaces it.

Import diagrams as PNG, JPEG or WebP files up to 5 MB. The browser downsizes images to a maximum edge of 2048 pixels before upload. Image placement, dimensions, rotation and added annotations are editable; text or shapes inside an imported raster are not. Replace diagram changes an image without changing its placement. SVG, PDF and remote image URLs are not accepted.

Viewers see partial strokes, typing and moves while the editor works, in both the enlarged view and the physical 3D board. Committed changes are saved separately from furniture layout. Moving a board keeps its content; deleting it closes its views and deletes its saved content and attachments. Copies/new item IDs start with a blank document.

**Done editing** flushes text changes and releases control. Members can request control; the current editor is notified. Owners/admins can release another editor. Disconnects, leaving, loss of access, deleting the board and server restarts release editing ownership. After connection loss, take control again using the latest saved document; unsaved work is not automatically replayed over another editor's changes.

Undo/redo is limited to the current editing turn (at most 30 changes / 4 MB). Clear requires confirmation. Up to ten persistent snapshots are retained before destructive actions and editing handovers. **Recover snapshot** restores the most recent different snapshot; this is itself undoable. Acknowledged content survives refresh and server restart.

## Implementation and operation

- Feature: `shared/whiteboard.ts`, `server/features/whiteboard/`, `client/src/features/whiteboard/`.
- The editor uses Fabric 7.4.0, loaded only when opening a board. The world surface uses a lightweight canvas texture updated on changes.
- Canonical documents contain allowlisted objects, not arbitrary Fabric JSON, HTML or executable/remote assets. Limits: 500 objects, 20 diagrams, 1 MB UTF-8 document, bounded drawing points/table sizes and rendering area.
- Per-board server queues grant exclusive leases, renewed every 5 seconds and expiring after 20 seconds. Fencing tokens, revisions and operation IDs reject stale/foreign writes and duplicate operations. Preview updates are rate-limited and never written individually to the database.
- Core migration 6 adds generic upload scopes/references; feature migration 900 adds board documents and bounded history. Existing migration SQL is unchanged. Migrations run automatically on server startup and support local PGlite and Postgres SQL; automated local checks use PGlite.
- Board uploads use existing storage/quota configuration. Reads require a connected authorized office socket and its upload key, with `private, no-store` caching. Scoped uploads cannot become public chat attachments. Current/history references protect diagrams from chat cleanup. Abandoned imports older than a day are removed at startup and every five minutes when no editing turn uses the board.
- Editing turns currently follow the application's single Node/Socket.IO server architecture. Multiple independent server instances would require a shared lease/coordinator before enabling writes across instances.
- Opening the dialog pauses avatar movement and game/office shortcuts while keeping the audio session active.

Restart the development server after installing dependencies so the new socket handlers and migrations load. In Git Bash: `DEV_LOGIN=true npm run dev`. Keep `DATABASE_URL` unset for local PGlite; developer login stays local.

Useful checks: `npm run typecheck`, `npm run build`, and `npm test -- --maxWorkers=1 --testTimeout=30000 --hookTimeout=60000`. The whiteboard-focused suites are `tests/whiteboard.test.ts` and `tests/whiteboard-server.test.ts`.
