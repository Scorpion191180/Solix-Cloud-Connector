import os


class SolixAuth:

    def __init__(self):
        self.email = os.getenv("ANKER_EMAIL")
        self.password = os.getenv("ANKER_PASSWORD")
        self.country = os.getenv("ANKER_COUNTRY", "DE")

    def configured(self):
        return bool(self.email and self.password)
