# Where your data lives

x-builder keeps everything on your machine. Your corpus of posts, the engagement numbers it tracks over time, and the context it uses to score and generate — all of it sits in a single local file, private to you. Nothing is uploaded anywhere.

This page explains where that file is, what's in it, and what happens the first time you start x-builder after this update.

## The local database

Your corpus and metric data live in one local SQLite database:

```txt
~/.x-builder/engine-settings/storage/x-builder.db
```

It sits in the same `storage` folder you may already know from earlier versions. A few things to know about it:

- **Local-only and private.** The file is created so that only your user account can read or write it (file permissions `0600`). It never leaves your machine — x-builder does not upload it.
- **One file.** All the corpus and metric data the app uses now reads and writes through this single database.
- **Don't hand-edit it.** x-builder manages this file for you. Opening it in a database tool and changing it by hand can corrupt your corpus. Treat it as internal storage, not a document you edit.

### Why a database instead of a JSON file

Earlier versions of x-builder kept the whole corpus in a single flat JSON file (`post-library.json`). As the corpus grew — more posts, plus engagement readings tracked over time — a flat file became the wrong shape for the job. Moving to an embedded database lets x-builder hold richer, related data (posts, their measured performance, where each post came from) and read or update just the slice it needs.

The change is invisible to how the rest of x-builder behaves. Same data, same features — only the on-disk format is different.

## What's in the database

The database holds the local data x-builder works with:

| What | What it is |
|---|---|
| Your post corpus | The canonical collection of your own posts |
| Metric observations | Engagement readings for your posts, recorded over time |
| Source provenance | Where each post came from (which import or capture brought it in) |
| Profile snapshots | A history of your follower count and handle over time |
| Import-run records | A record of each import that has run |
| Derived insights | Conclusions x-builder works out from the data above |
| Active scoring context | The settings currently used to score your drafts |
| Voice retrieval index | Rebuildable local embeddings used to choose better own-post voice samples for generation |

What it does **not** hold:

- **Raw archive file contents.** When you import an X data export, the database stores the posts that came out of it — not the original archive file itself.
- **Raw cloud/model data.** The voice retrieval index is local derived data. x-builder does not upload it or store hosted embedding responses.

### Canonical corpus vs. voice index

The post corpus and metric observations are the source of truth. The voice retrieval index is different: it is a rebuildable projection of your own original posts, used only to pick better examples for generation prompts. If the index is missing, stale, or cannot be read, x-builder falls back to recent original posts and keeps generation working.

You should treat both as internal storage. Do not hand-edit the database.

## The one-time migration

If you used an earlier version, your corpus was in `post-library.json` in the same `storage` folder. You don't need to move it yourself.

The first time you start x-builder after this update, it automatically:

1. Imports your existing `post-library.json` into the new database, and
2. Renames the old file to `post-library.json.migrated`.

That's the whole migration. A few details:

- **It runs once.** After the import, the original `post-library.json` no longer exists (it's been renamed), so there is nothing left to import. Restarting x-builder does nothing further — it won't re-import or duplicate your posts.
- **The old file is kept as a backup.** The renamed `post-library.json.migrated` is left in place on purpose. Keep it if you'd like a backup of your pre-migration corpus, or delete it once you're satisfied — x-builder does not need it and does not touch it again.
- **Nothing for you to do.** There is no setting to turn on and no button to press. If there was no `post-library.json` to begin with (a fresh install), there's simply nothing to migrate, and x-builder starts with an empty database.

### This is not the archive import

Don't confuse the automatic migration above with **archive import**, which is a separate, unrelated feature:

- **The migration** is automatic, one-time, and about moving your *existing* corpus from the old JSON file into the new database. You don't trigger it.
- **Archive import** is something *you* start, when *you* choose, to load your full post history from a `tweets.js` file out of your X data export. It's optional and you can run it whenever you like.

They are different things. The migration happens on its own once; archive import is a deliberate action you take.

<!-- Tickets: LPF-001..LPF-006, VRG-001..VRG-006 — local SQLite store + local voice index; verified 2026-06-29 -->
