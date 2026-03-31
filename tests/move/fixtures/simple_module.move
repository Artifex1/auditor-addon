module example::counter {
    fun increment(value: u64): u64 {
        value + 1
    }

    fun add(a: u64, b: u64): u64 {
        a + b
    }

    public fun main() {
        let x = increment(1);
        let y = add(x, 2);
    }
}
