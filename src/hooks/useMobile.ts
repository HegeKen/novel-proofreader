// ============================================================
// 移动端状态管理 Hook
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { isMobileDevice, getDeviceType } from "../utils/mobile";

/**
 * 自定义 Hook：管理移动端状态
 * @returns isMobile - 是否为移动端
 * @returns deviceType - 设备类型
 * @returns checkMobile - 手动检查移动端状态
 */
export function useMobile() {
	const [isMobile, setIsMobile] = useState(isMobileDevice);
	const [deviceType, setDeviceType] = useState(getDeviceType);

	const checkMobile = useCallback(() => {
		setIsMobile(isMobileDevice());
		setDeviceType(getDeviceType());
	}, []);

	useEffect(() => {
		checkMobile();
		window.addEventListener("resize", checkMobile);
		return () => window.removeEventListener("resize", checkMobile);
	}, [checkMobile]);

	return {
		isMobile,
		deviceType,
		checkMobile,
	};
}