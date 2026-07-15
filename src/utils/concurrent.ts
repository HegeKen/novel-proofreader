export class Semaphore {
	private permits: number;
	private queue: Array<() => void> = [];

	constructor(permits: number) {
		this.permits = permits;
	}

	async acquire(): Promise<void> {
		return new Promise((resolve) => {
			if (this.permits > 0) {
				this.permits--;
				resolve();
			} else {
				this.queue.push(resolve);
			}
		});
	}

	release(): void {
		this.permits++;
		if (this.queue.length > 0) {
			const next = this.queue.shift();
			if (next) {
				this.permits--;
				next();
			}
		}
	}
}

export class Queue<T> {
	private items: T[] = [];
	private resolvers: Array<(item: T) => void> = [];

	enqueue(item: T): void {
		if (this.resolvers.length > 0) {
			const resolve = this.resolvers.shift()!;
			resolve(item);
		} else {
			this.items.push(item);
		}
	}

	dequeue(): Promise<T> {
		if (this.items.length > 0) {
			return Promise.resolve(this.items.shift()!);
		}
		return new Promise((resolve) => {
			this.resolvers.push(resolve);
		});
	}

	isEmpty(): boolean {
		return this.items.length === 0;
	}

	size(): number {
		return this.items.length;
	}
}