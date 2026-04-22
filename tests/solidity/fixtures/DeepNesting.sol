contract DeepNesting {
    function complex(uint a, uint b, uint c) public {
        if (a > 0) {
            if (b > 0) {
                if (c > 0) {
                    return;
                }
            }
        }
    }
}
