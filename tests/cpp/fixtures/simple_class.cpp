class Counter {
public:
    void increment() {
        value += 1;
    }

    int get() {
        return value;
    }

private:
    int value = 0;
};
