pub struct Vault {
    balance: u64,
}

impl Vault {
    pub fn deposit(&mut self, amount: u64) {
        self.balance += amount;
        self.log_event();
    }

    pub fn withdraw(&mut self, amount: u64) {
        self.check_balance(amount);
        self.balance -= amount;
    }

    fn check_balance(&self, amount: u64) {
        if self.balance < amount {
            panic!("insufficient balance");
        }
    }

    fn log_event(&self) {}
}
