from concurrent.futures import ThreadPoolExecutor


def money(cents):
    return f"{cents / 100:.2f}"


def run_all(tasks):
    # .execute on something that is no database: not a data use
    with ThreadPoolExecutor() as pool:
        return [pool.submit(t).result() for t in tasks]


class Executor:
    def execute(self, sql):
        return sql


def not_a_cursor():
    return Executor().execute("SELECT * FROM fake_table")
