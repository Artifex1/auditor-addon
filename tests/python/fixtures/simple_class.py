class Counter:
    def __init__(self):
        self.value = 0

    def increment(self):
        self.value += 1

    def get(self):
        return self.value

    def _reset(self):
        self.value = 0
