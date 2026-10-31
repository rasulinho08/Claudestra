---
name: sql-basics
description: Use when you need to store or analyse tabular data in SQLite with Python sqlite3 or Node node:sqlite: schema design, safe parameterised queries and common analytical queries.
---
# SQL basics with SQLite

## Tools (already installed)
- Python: `import sqlite3` (always available, preferred for one-off analysis).
- Node 22: `import { DatabaseSync } from 'node:sqlite'` (built in; prints an ExperimentalWarning; on Node older than 22.13 it needs `--experimental-sqlite`, else use Python).
- No `sqlite3` CLI is assumed. Keep the database inside the workspace, e.g. `data/app.db`; never commit real personal data.

## Schema design
1. One table per thing (`customers`, `orders`); `id INTEGER PRIMARY KEY` in each.
2. Foreign keys: `customer_id INTEGER NOT NULL REFERENCES customers(id)`, and run `PRAGMA foreign_keys = ON;` on every connection.
3. Types: `INTEGER`, `REAL`, `TEXT`. Store money as integer qəpik/cents, dates as ISO text `YYYY-MM-DD` (or `YYYY-MM-DDTHH:MM:SSZ` in UTC).
4. Add `NOT NULL`, `UNIQUE` and `CHECK (amount >= 0)` where the task implies them; index columns used in `WHERE`/`JOIN` (`CREATE INDEX idx_orders_customer ON orders(customer_id);`).
5. Put the schema in `schema.sql` with `CREATE TABLE IF NOT EXISTS ...` so it can be re-run.

## Safe queries (always parameterised)
```python
import sqlite3
con = sqlite3.connect('data/app.db')
con.execute('PRAGMA foreign_keys = ON')
con.executescript(open('schema.sql', encoding='utf-8').read())
with con:  # commits or rolls back
    con.executemany('INSERT INTO customers(name, city) VALUES (?, ?)',
                    [('Aysel', 'Bakı'), ('Rəşad', 'Gəncə')])
rows = con.execute('SELECT name FROM customers WHERE city = ?', (city,)).fetchall()
```
```js
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/app.db');
const rows = db.prepare('SELECT name FROM customers WHERE city = ?').all(city);
```
- Never build SQL with f-strings, `+` or template literals from user input. Table/column names cannot be parameters: pick them from a fixed allow-list.
- Wrap multi-row writes in one transaction; it is both safer and much faster.
- Load CSV with Python `csv` + `executemany` (see skill `data-cleaning-csv` first).

## Common analytical queries
```sql
-- totals per group, biggest first
SELECT city, COUNT(*) AS n, SUM(amount) AS total FROM orders GROUP BY city ORDER BY total DESC;
-- monthly trend
SELECT substr(order_date, 1, 7) AS month, SUM(amount) FROM orders GROUP BY month ORDER BY month;
-- groups above a threshold
SELECT customer_id, COUNT(*) AS n FROM orders GROUP BY customer_id HAVING n >= 3;
-- customers with no orders
SELECT c.* FROM customers c LEFT JOIN orders o ON o.customer_id = c.id WHERE o.id IS NULL;
-- top 3 per group (window function, SQLite 3.25+)
SELECT * FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY city ORDER BY amount DESC) AS rn FROM orders) WHERE rn <= 3;
-- duplicates by key
SELECT email, COUNT(*) FROM customers GROUP BY email HAVING COUNT(*) > 1;
```
Watch out: `COUNT(col)` skips NULLs, `AVG` ignores NULLs, integer division truncates (`SUM(a) * 1.0 / COUNT(*)`), and `LIKE` is case-insensitive only for ASCII (Azerbaijani `Ə/ə`, `İ/i` will not match case-insensitively; normalise in code).

## Before reporting results
- [ ] Show the exact SQL you ran next to each number.
- [ ] State row counts and how NULLs/missing values were handled.
- [ ] Check one result by hand on a small sample.
- [ ] Use `EXPLAIN QUERY PLAN` if a query on a large table is slow; add an index rather than rewriting logic.
