import { useRef, useCallback } from "react";

interface SwipeHandlers {
	onTouchStart: (e: React.TouchEvent) => void;
	onTouchMove: (e: React.TouchEvent) => void;
	onTouchEnd: (e: React.TouchEvent) => void;
}

interface UseSwipeGestureOptions {
	onSwipeLeft?: () => void;
	onSwipeRight?: () => void;
	threshold?: number;
}

export function useSwipeGesture(options: UseSwipeGestureOptions): SwipeHandlers {
	const { onSwipeLeft, onSwipeRight, threshold = 50 } = options;
	const startX = useRef<number>(0);
	const startY = useRef<number>(0);
	const isHorizontalSwipe = useRef<boolean | null>(null);

	const onTouchStart = useCallback((e: React.TouchEvent) => {
		startX.current = e.touches[0].clientX;
		startY.current = e.touches[0].clientY;
		isHorizontalSwipe.current = null;
	}, []);

	const onTouchMove = useCallback((e: React.TouchEvent) => {
		if (isHorizontalSwipe.current === false) return;

		const currentX = e.touches[0].clientX;
		const currentY = e.touches[0].clientY;
		const deltaX = currentX - startX.current;
		const deltaY = currentY - startY.current;

		if (isHorizontalSwipe.current === null) {
			if (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10) {
				isHorizontalSwipe.current = Math.abs(deltaX) > Math.abs(deltaY);
			}
		}
	}, []);

	const onTouchEnd = useCallback((e: React.TouchEvent) => {
		if (isHorizontalSwipe.current !== true) {
			isHorizontalSwipe.current = null;
			return;
		}

		const endX = e.changedTouches[0].clientX;
		const deltaX = endX - startX.current;

		if (Math.abs(deltaX) >= threshold) {
			if (deltaX < 0 && onSwipeLeft) {
				onSwipeLeft();
			} else if (deltaX > 0 && onSwipeRight) {
				onSwipeRight();
			}
		}

		isHorizontalSwipe.current = null;
	}, [onSwipeLeft, onSwipeRight, threshold]);

	return { onTouchStart, onTouchMove, onTouchEnd };
}
