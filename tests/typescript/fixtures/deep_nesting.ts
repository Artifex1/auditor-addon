function deeplyNested(x: number): void {
    if (x > 0) {
        if (x > 10) {
            if (x > 100) {
                console.log("very large");
            }
        }
    }
}
