module example::nested {
    fun deeply_nested(x: u64) {
        if (x > 0) {
            if (x > 10) {
                if (x > 100) {
                    abort 0
                }
            }
        }
    }
}
