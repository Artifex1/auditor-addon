class Counter {
    private value: number = 0;

    public increment(): void {
        this.value += 1;
    }

    public get(): number {
        return this.value;
    }
}
