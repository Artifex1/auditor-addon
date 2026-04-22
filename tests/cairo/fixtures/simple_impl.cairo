trait ICounter {
    fn increment(ref self: ContractState);
    fn get(self: @ContractState) -> u32;
}

impl CounterImpl of ICounter {
    fn increment(ref self: ContractState) {
        self.value.write(self.value.read() + 1);
    }

    fn get(self: @ContractState) -> u32 {
        self.value.read()
    }
}
