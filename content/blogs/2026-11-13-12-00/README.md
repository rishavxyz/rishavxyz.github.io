# B-Tree vs B+ Tree: The Difference That Makes Range Queries Feel Easy

Database indexes can feel like a black box: you add one, a query gets faster, and the explanation ends there. This post opens that box. We will build an intuitive picture of B-trees and B+ trees, see why their structure matters for lookups and range queries, and connect that knowledge back to practical index design.

The short answer is that both keep sorted data in wide, balanced trees. A traditional B-tree can store records in internal nodes as well as leaves. A B+ tree stores the records in leaves, while internal nodes act as a compact directory. That design makes range scans wonderfully natural.

[In my previous blog](/blogs/how-caching-and-indexing-work-in-sqlite/), I introduced B-trees as the structure behind SQLite tables and indexes. That raises a fair question: why do database articles also talk about B+ trees? The names are nearly identical, the diagrams can look suspiciously alike, and the difference is easy to gloss over. This is the explanation I wish I had found the first time I ran into both terms.

The longer answer helps explain why indexes work so well for both `WHERE id = ?` and `WHERE created_at BETWEEN ? AND ?`.

---

## First, the “B” does not mean binary

A binary search tree gives each node at most two children. That is lovely for a classroom, but it is a poor fit for storage. A database would have to visit a huge number of nodes to find a row in a large table, and each node visit might mean reading another disk page.

A B-tree is **wide**. One node can hold many sorted keys and many child pointers. A simplified node might look like this:

```text
          [ 20 | 45 | 80 ]
         /     |     |     \
   <20      20–44  45–79   ≥80
```

If a key is `57`, the database compares it with the keys in the current node, follows the `45–79` pointer, and repeats. Because each node represents a full storage page and has many children, the tree stays shallow. A few page reads can navigate a very large index.

Two rules keep the tree reliable:

1. Keys within a node stay sorted.
2. All leaves remain at the same depth.

When a node becomes full, the tree splits it. When one becomes too empty after deletes, the tree may rebalance it. The exact split details vary by implementation, but the promise is the same: lookup remains logarithmic and the tree does not become a long, sad chain.

## A traditional B-tree can keep records anywhere

In the textbook version of a B-tree, an internal node can contain a key _and its associated record_. A successful lookup might end at the root, an internal node, or a leaf:

```text
                 [ 40: "Mina" ]
                 /              \
      [ 10: "Ana", 25: "Bo" ]  [ 55: "Omar", 70: "Rae" ]
```

There is something elegant about that: find the key, find the record. But it has a tradeoff. Internal nodes now need room for full records as well as routing keys and child pointers. They fit fewer children, which can make the tree taller.

It also makes a range scan a little less straightforward. The next record after a match might be in a child subtree, an ancestor node, or a neighboring subtree. The database can absolutely do it—it just has more navigation work to perform.

## A B+ tree makes internal nodes a directory

A B+ tree draws a sharper line. Internal nodes hold only separator keys and child pointers. The actual indexed entries live in the leaves:

```text
                    [ 30 | 60 ]
                  /      |      \
                /        |        \
      [ 5 | 12 | 22 ] [ 30 | 41 | 57 ] [ 60 | 73 | 91 ]
             ↔──────────────↔──────────────↔
                 linked leaf pages, in key order
```

The keys in an internal node tell the search where to go; they are not the canonical place that the data lives. Since these directory pages are compact, each one can usually point to more children. More children means fewer levels between the root and a leaf.

The other defining feature is the leaf level. B+ tree leaves are ordered, and many implementations link adjacent leaves. To read a range, the database does this:

1. Walk from the root to the first matching leaf.
2. Read entries until the end of that leaf.
3. Continue to the next leaf in sorted order.
4. Stop when the upper bound or `LIMIT` is reached.

That is exactly the shape of a common query:

```sql
SELECT id, title, published_at
FROM articles
WHERE published_at >= '2026-01-01'
  AND published_at < '2027-01-01'
ORDER BY published_at
LIMIT 50;
```

With an appropriate index beginning with `published_at`, the database can seek once and then read forward. It does not need to find 50 independent rows and sort them afterward.

## The practical comparison

| Property               | B-tree                                            | B+ tree                                            |
| ---------------------- | ------------------------------------------------- | -------------------------------------------------- |
| Where records may live | Internal nodes and leaves                         | Leaves only                                        |
| Internal-node contents | Keys, child pointers, sometimes records           | Separator keys and child pointers                  |
| Search result          | May finish before reaching a leaf                 | Reaches a leaf                                     |
| Fan-out                | Potentially lower if records are large            | Usually higher because directory entries are small |
| Range scan             | Requires tree navigation between records/subtrees | Natural sequential scan across ordered leaves      |
| Typical use            | General balanced search tree                      | Database and storage-engine indexes                |

These are families of data structures, not laws of nature. Real database engines make sensible variations for page layout, duplicate keys, concurrency, prefix compression, and crash recovery. The comparison is still valuable because it reveals the central design choice: do internal pages store data, or do they primarily help you find leaf pages that do?

## Why databases like the B+ tree idea

Databases care deeply about pages. Reading one storage page can bring in many adjacent keys at once, and a page cache can keep a useful upper part of the tree warm. A compact root and compact internal levels are therefore extremely valuable.

Imagine an index with millions of entries. The root and the next level are likely visited often enough to remain cached. A lookup may need only one or two more page reads to reach its leaf. A range query then proceeds through nearby leaf data in key order, which is friendly to caches and storage.

This is also why a composite index can satisfy sorting as well as filtering. With an index like this:

```sql
CREATE INDEX articles_by_author_and_date
ON articles (author_id, published_at DESC);
```

all entries for a single author are already grouped together, newest first. SQLite can seek to that author’s portion of the index and walk forward. The sort order is not computed after the fact; it is part of the tree’s physical ordering.

## So, is SQLite using a B-tree or a B+ tree?

SQLite calls its structures **B-trees**, and that is the right name to use when discussing SQLite. Its on-disk format has interior and leaf B-tree pages, and the details differ between table B-trees and index B-trees.

There is, however, a useful B+ tree resemblance:

- Table records are stored on leaf pages; interior table pages route searches using integer keys and child pointers.
- Index entries live on index leaf pages; interior index pages guide a search toward the relevant leaf range.
- Internal pages are mostly navigation structure, while leaf pages contain the information needed to answer the query.

SQLite is not simply “a B+ tree implementation with a new name.” In particular, its B-tree format does not use the textbook always-linked-leaf layout often shown in B+ tree diagrams. SQLite cursors can move through a range by navigating the tree as needed. That is an implementation detail worth respecting: the mental model explains performance, but the file format gets the final say.

For day-to-day SQL, the distinction changes less than you might expect. You still choose an index based on predicates, joins, and ordering; then you use `EXPLAIN QUERY PLAN` to see whether SQLite can traverse it efficiently.

## Equality lookup and range scan, side by side

The value of the leaf-oriented design is easiest to see when the query changes only a little.

An equality lookup:

```sql
SELECT *
FROM users
WHERE email = ?;
```

uses the index as a directory: root, internal pages, target leaf, matching entry. Both B-trees and B+ trees do this well.

A range lookup:

```sql
SELECT *
FROM events
WHERE occurred_at >= ?
  AND occurred_at < ?
ORDER BY occurred_at;
```

starts the same way, but it needs every matching entry after the first. A leaf-oriented, ordered structure turns the rest of the task into sequential traversal rather than many separate root-to-leaf searches. That is why index order matters so much for timelines, feeds, pagination, and `BETWEEN` queries.

## What this means when you design an index

You do not need to memorize tree-splitting algorithms to benefit from them. A few habits line up your SQL with the structure beneath it:

- Put the columns you filter by most predictably at the start of a composite index.
- Follow them with columns used for range conditions or `ORDER BY` when the query pattern supports it.
- Use `LIMIT` for lists. It lets the engine stop its ordered walk early.
- Consider a covering index for a measured hot read, but remember it adds write and storage cost.
- Confirm the plan with `EXPLAIN QUERY PLAN`; an index that exists is not necessarily an index the planner can use for a particular query.

## The memorable version

A B-tree is a balanced, wide search tree built for storage pages. A B+ tree takes the idea one step further: internal pages become a compact map, while ordered leaf pages become the place where data is read in sequence.

That is why an index is more than a lookup shortcut. It is an ordered path through data. When your query’s filters and sort order match that path, the database gets to do what it is very good at: seek once, walk a small number of pages, and stop early.
