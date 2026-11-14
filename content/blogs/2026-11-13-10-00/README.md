# How Caching and Indexing Actually Work in SQLite

SQLite is often introduced as “a database in a file.” That is true, but it can leave a misleading picture: every query opens a file, rummages through it from beginning to end, and closes it again. In reality, SQLite is very good at avoiding unnecessary disk work. It has a page cache, the operating system has its own cache, write-ahead logging gives readers a stable view during writes, and B-tree indexes let a query jump close to the answer.

Those mechanisms are related, but they are not interchangeable. A cache helps when you need the same pages again; an index helps SQLite find the _right_ pages in the first place.

Let’s follow a query through the system and make the tuning choices feel less mysterious.

---

## First: SQLite reads pages, not rows

SQLite stores a database as fixed-size **pages**. A page is commonly 4 KiB, although the page size is chosen when the database is created and can differ. Tables and indexes are B-trees made from these pages.

Suppose you run this query:

```sql
SELECT title, published_at
FROM articles
WHERE author_id = ?
ORDER BY published_at DESC
LIMIT 20;
```

SQLite does not load an `Article` object or read a magical “articles file.” It reads B-tree pages: first enough pages to navigate to matching entries, then enough pages to return the requested columns. Keeping recently used pages nearby is the job of caching. Arranging those pages so the navigation is short is the job of indexing.

That page-oriented model explains a lot of SQLite behavior, including why a query that returns only 20 rows can still be slow if it has to inspect a million of them first.

## There are usually two caches involved

When people say, “SQLite cached it,” they may mean either of two layers.

### SQLite’s page cache

Every SQLite database connection maintains a page cache in its own process memory. When the engine needs a page, it checks this cache before asking the operating system to read the database file. A cache hit avoids work inside SQLite and usually avoids a system call too.

The cache size is configurable per connection with `PRAGMA cache_size`:

```sql
-- A positive value is a number of pages.
PRAGMA cache_size = 2000;

-- A negative value is an approximate number of KiB.
PRAGMA cache_size = -8192;
```

The negative form is often easier to reason about because a page count means different amounts of memory for different page sizes. These are not universal “make SQLite fast” settings. A larger cache may reduce reads for a busy, long-lived connection; it may also waste memory if the process has many connections or rarely revisits data.

One easy mistake is expecting this cache to be shared across all connections. It normally is not. If an application opens a fresh connection for every tiny operation, it gives SQLite less chance to reuse its own cached pages. A sensible connection lifecycle matters before a heroic cache size does.

### The operating system’s filesystem cache

Below SQLite, the operating system also caches file data in memory. If SQLite asks it for a database page that was read recently, the OS can often satisfy the read without touching physical storage.

This is why “I restarted my application and the query was still fast” is not proof that SQLite’s connection-local cache survived. The process cache may be cold while the filesystem cache is warm. Conversely, a benchmark immediately after a machine restart may exaggerate the cost of disk reads.

For normal applications, let both layers do their jobs. Do not try to manually copy a database into RAM just because it sounds fast. Start with a good schema, good queries, and real measurements.

## WAL changes how readers and writers meet

SQLite supports several journal modes. For many server-style workloads, **write-ahead logging** (WAL) is a helpful choice:

```sql
PRAGMA journal_mode = WAL;
```

In the traditional rollback-journal mode, a writer may need to block readers at awkward moments. In WAL mode, a writer appends changed pages to a separate WAL file rather than overwriting the main database file immediately. Readers can continue using a consistent snapshot of the database while the write is happening.

That does not mean unlimited concurrent writing. SQLite still permits one writer at a time. WAL improves the relationship between readers and a writer; it does not turn a single database file into a multi-writer distributed database.

Eventually, a **checkpoint** copies committed WAL pages back into the main database file. Checkpointing is normal housekeeping, but a reader that holds a very old transaction open can prevent the WAL from being fully checkpointed. In practice, keep read transactions short—especially in long-running jobs and streaming handlers.

The useful mental model is:

```text
reader begins → chooses a stable snapshot → reads database/WAL pages
writer begins → appends changed pages to WAL → commits
reader ends   → newer readers can see the new snapshot
checkpoint    → folds WAL pages back into the main database file
```

## An index is a search structure, not a speed spell

A normal SQLite index is a B-tree. Its entries are sorted by the indexed columns and point to the corresponding table rows (or contain enough information to identify them). Instead of scanning every row to find one author, SQLite can walk the tree from its root to the matching range.

For the article query above, this index matches both the filter and the requested ordering:

```sql
CREATE INDEX articles_by_author_and_date
ON articles (author_id, published_at DESC);
```

Now SQLite can seek to one `author_id`, walk entries in newest-first order, and stop after 20 results. It does not need to build a temporary sorted list of every article by that author.

The order of columns is meaningful. A multi-column index is most useful from its **leftmost** columns onward. Given this index:

```sql
CREATE INDEX games_by_category_status_date
ON games (category_id, status, published_at DESC);
```

SQLite can efficiently use it for a query that starts with `category_id`, and usually for `category_id` plus `status`. It is not generally a replacement for an index that starts with only `status`, because the entries are grouped by category first.

Think of it like a paper directory sorted by last name and then first name. It is excellent when you know the last name; it is not ideal when you only know a first name.

## Covering indexes save an extra table lookup

An index can occasionally answer a query by itself. If the query only needs columns already stored in the index, SQLite does not need to visit the table B-tree for each matching row. This is called a **covering index**.

```sql
CREATE INDEX articles_feed_covering
ON articles (author_id, published_at DESC, title);

SELECT title, published_at
FROM articles
WHERE author_id = ?
ORDER BY published_at DESC
LIMIT 20;
```

The index above contains the filter column, the sort column, and the two selected values. On a read-heavy list endpoint, that can be a nice win.

But do not add every column to every index. Each index consumes disk space, memory cache space, and write time: inserting or updating a row means updating its relevant indexes too. A covering index is worth considering for a measured hot query, not as a default decoration.

## How SQLite decides which index to use

SQLite has a query planner. It considers the tables, conditions, available indexes, and estimated costs, then chooses a plan. You can ask to see that plan without running a mysterious profiler:

```sql
EXPLAIN QUERY PLAN
SELECT title, published_at
FROM articles
WHERE author_id = 42
ORDER BY published_at DESC
LIMIT 20;
```

Useful phrases in the result include:

- `SEARCH ... USING INDEX` — SQLite found an index-based access path.
- `USING COVERING INDEX` — the index contains all values needed by the query.
- `SCAN` — SQLite is walking a whole table or index. This is not automatically wrong; it may be perfect for a small table or a query that needs most rows.
- `USE TEMP B-TREE FOR ORDER BY` — SQLite could not get the required order directly from an index and must sort intermediate results.

Plans are clues, not report cards. A full scan over 50 rows is often simpler and faster than an index lookup. A full scan over millions of rows for a selective lookup is worth investigating.

## Statistics help the planner make a less bad guess

The planner estimates how many rows a condition will match. If it has poor information, it can choose an index that looks good on paper but produces too many lookups in practice.

After large data changes or after introducing important indexes, update SQLite’s statistics:

```sql
ANALYZE;
```

For applications that run maintenance periodically, `PRAGMA optimize` is a lightweight way to let SQLite decide whether useful optimization work is due:

```sql
PRAGMA optimize;
```

The right moment depends on the application. A tiny local database may need neither command outside development. A database whose distribution changes substantially over time benefits from refreshed statistics. The important habit is to measure the actual query plan before and after, rather than treating maintenance as a ritual.

## A practical indexing workflow

When a query is slow, I use this order of operations:

1. **Write down the real query.** Include the `WHERE`, `JOIN`, `ORDER BY`, and `LIMIT` clauses used in production.
2. **Check `EXPLAIN QUERY PLAN`.** Look for unnecessary scans or temporary sort B-trees.
3. **Estimate selectivity.** An index is most valuable when it quickly rules out most rows.
4. **Build the smallest index that matches the access pattern.** Put equality filters first, then range or ordering columns where appropriate.
5. **Test writes too.** An index that speeds up one dashboard query can make a frequent bulk import slower.
6. **Keep the index only if it earns its maintenance cost.** “Might be useful someday” is how indexes multiply.

For example, a searchable admin list might use separate indexes for the stable filters it actually offers, rather than one giant index attempting to anticipate every possible search combination.

## Things that look like SQLite problems but are not

It is easy to blame the database because that is where a request appears to pause. A few common culprits live elsewhere:

- **N+1 queries:** fetching related data once per row multiplies round trips and query work. Fetch a relation in a deliberate batch or join when appropriate.
- **Long transactions:** a slow network response or large computation held inside a transaction can make writers wait.
- **Unbounded result sets:** an index cannot make returning hundreds of thousands of JSON rows pleasant.
- **Repeated connections:** creating and destroying a connection for every request loses useful local state and adds overhead.
- **A cold benchmark:** the first query after storage has gone cold measures a different world from a busy application.

SQLite is remarkably capable, but it cannot make an unnecessarily large response, a blocked writer, or an inefficient application loop disappear.

## The short version

Caching makes recently used database pages cheap to revisit. Indexing makes the pages you need cheap to find. WAL lets readers see a stable snapshot while a single writer appends changes. The query planner connects your SQL to those structures, and `EXPLAIN QUERY PLAN` lets you inspect its work instead of guessing.

Start with the query your users actually run. Index the filter and ordering pattern it truly has. Keep transactions short. Let the operating system and SQLite cache naturally. Then measure again. That is less dramatic than a database-tuning checklist, but it is how a small SQLite database stays pleasantly fast as it grows.
