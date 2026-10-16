import psycopg2


def nightly(event, context):
    conn = psycopg2.connect("dbname=shop")
    cur = conn.cursor()
    # SELECT * FROM ghost_table is a comment, not a query
    cur.execute("""
        WITH recent AS (SELECT * FROM orders_archive WHERE day > now() - interval '1 day')
        -- FROM comment_table
        INSERT INTO daily_totals SELECT day, sum(total) FROM recent GROUP BY day
    """)
    name = event.get("table")
    cur.execute(f"SELECT * FROM {name}")
    conn.commit()
