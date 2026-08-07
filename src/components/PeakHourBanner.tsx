import { useEffect, useState } from "react";
import { Icons } from "./Icons";

// 高峰时段定义（北京时间 UTC+8）
// DeepSeek: 9:00-12:00, 14:00-18:00
const PEAK_PERIODS = [
	{ start: 9, end: 12 },
	{ start: 14, end: 18 },
];

/** 获取当前北京时间的小时数 */
function getBeijingHour(): number {
	const now = new Date();
	return (now.getUTCHours() + 8) % 24;
}

/** 判断当前是否处于高峰时段 */
function isInPeakPeriod(): boolean {
	const hour = getBeijingHour();
	return PEAK_PERIODS.some((p) => hour >= p.start && hour < p.end);
}

/** 根据 baseURL 和 model 判断提供商是否有峰谷定价 */
function hasPeakPricing(baseURL: string, model: string): boolean {
	const url = baseURL.toLowerCase();
	const mdl = model.toLowerCase();
	// DeepSeek 官方 API
	if (url.includes("deepseek")) return true;
	// SiliconFlow 代理 DeepSeek 模型
	if (url.includes("siliconflow") && mdl.includes("deepseek")) return true;
	// 腾讯云 TokenHub 透传 DeepSeek
	if (url.includes("tencent") && mdl.includes("deepseek")) return true;
	return false;
}

interface PeakHourBannerProps {
	/** API baseURL */
	baseURL: string;
	/** 模型名称 */
	model: string;
}

/** 高峰时段滚动横幅 */
export function PeakHourBanner({ baseURL, model }: PeakHourBannerProps) {
	const [inPeak, setInPeak] = useState(false);

	useEffect(() => {
		const check = () => {
			setInPeak(hasPeakPricing(baseURL, model) && isInPeakPeriod());
		};
		check();
		const interval = setInterval(check, 60000);
		return () => clearInterval(interval);
	}, [baseURL, model]);

	if (!inPeak) return null;

	return (
		<div className="peak-hour-banner">
			<div className="peak-hour-banner-icon">
				<Icons.alertTriangle size={14} />
			</div>
			<div className="peak-hour-banner-marquee">
				<span className="peak-hour-banner-text">
					当前处于 DeepSeek 高峰时段（北京时间 9:00-12:00 / 14:00-18:00），API 价格为平时 2 倍，请注意用量控制
					&emsp;&emsp;&emsp;&emsp;
					当前处于 DeepSeek 高峰时段（北京时间 9:00-12:00 / 14:00-18:00），API 价格为平时 2 倍，请注意用量控制
					&emsp;&emsp;&emsp;&emsp;
				</span>
			</div>
		</div>
	);
}
