import os


class SolixAuth:

    def __init__(self):
        self.email = os.getenv("ANKER_EMAIL")
        self.password = os.getenv("ANKER_PASSWORD")
        self.country = os.getenv("ANKER_COUNTRY", "DE")

    def configured(self):
        return (
            self.email is not None
            and self.password is not None
            and len(self.email) > 0
            and len(self.password) > 0
        )

    def info(self):
        return {
            "configured": self.configured(),
            "country": self.country,
            "email": "***" if self.email else None
        }
