import { getIndicatorDefinition } from './indicators/registry.js';

export const drawStockChart = ({
    chartCanvas,
    resizeChartCanvas,
    candles,
    activeIndicators,
    chartHoverPoint,
    currentChartInterval,
    priceScaleZoom = 1,
    formatChartTime,
    setChartStatus,
}) => {
    if (!chartCanvas) return;

    const canvas = resizeChartCanvas();
    if (!canvas) return;

    const { ctx, width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    if (!candles.length) {
        setChartStatus('표시할 차트 데이터가 없습니다.');
        return;
    }

    setChartStatus('');

    const padding = { top: 18, right: 64, bottom: 42, left: 16 };
    const overlayIndicators = activeIndicators.filter((indicator) => {
        return getIndicatorDefinition(indicator.key)?.panel === 'overlay';
    });
    const lowerIndicators = activeIndicators.filter((indicator) => {
        return getIndicatorDefinition(indicator.key)?.panel === 'lower';
    });
    const indicatorPanelHeight = lowerIndicators.length
        ? Math.max(58, Math.min(78, Math.floor(height * 0.12)))
        : 0;
    const totalIndicatorHeight = lowerIndicators.length * indicatorPanelHeight;
    const volumeHeight = Math.floor(height * 0.16);
    const chartSectionGap = 24;
    const panelGap = 10;
    const volumeTop = height - padding.bottom - volumeHeight;
    const firstLowerPanelTop = volumeTop - panelGap - totalIndicatorHeight;
    const priceBottom = (lowerIndicators.length ? firstLowerPanelTop : volumeTop) - chartSectionGap;
    const plotWidth = width - padding.left - padding.right;
    const priceHeight = priceBottom - padding.top;
    if (plotWidth <= 0 || priceHeight <= 0) {
        return;
    }
    const closes = candles.map((candle) => candle.close);
    const overlaySeriesForScale = [];

    overlayIndicators.forEach((indicator) => {
        const definition = getIndicatorDefinition(indicator.key);
        if (!definition?.getScaleSeries) return;
        overlaySeriesForScale.push(...definition.getScaleSeries(indicator, candles));
    });

    const prices = candles.flatMap((candle) => [candle.high, candle.low])
        .concat(overlaySeriesForScale.flat().filter((value) => Number.isFinite(value)));
    const rawMaxPrice = Math.max(...prices);
    const rawMinPrice = Math.min(...prices);
    const rawPriceRange = Math.max(1, rawMaxPrice - rawMinPrice);
    const priceCenter = (rawMaxPrice + rawMinPrice) / 2;
    const safePriceScaleZoom = Math.max(0.25, Math.min(8, priceScaleZoom));
    const priceRange = rawPriceRange / safePriceScaleZoom;
    const maxPrice = priceCenter + priceRange / 2;
    const minPrice = priceCenter - priceRange / 2;
    const maxVolume = Math.max(1, ...candles.map((candle) => candle.volume || 0));
    const candleGap = plotWidth / candles.length;
    const bodyWidth = Math.max(1, Math.min(12, candleGap * 0.62));

    const formatVolumeAxis = (value) => {
        if (value >= 1000000000) return `${(value / 1000000000).toFixed(1)}B`;
        if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
        if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
        return Math.round(value).toLocaleString('ko-KR');
    };

    const yForPrice = (price) => {
        return padding.top + ((maxPrice - price) / priceRange) * priceHeight;
    };

    const priceForY = (y) => {
        return maxPrice - ((y - padding.top) / priceHeight) * priceRange;
    };

    const volumeForY = (y) => {
        const distanceFromBottom = height - padding.bottom - y;
        return Math.max(0, (distanceFromBottom / volumeHeight) * maxVolume);
    };

    const drawAxisLabel = (text, x, y, options = {}) => {
        const {
            align = 'right',
            background = '#0f172a',
            color = '#e2e8f0',
            minX = 0,
            maxX = width,
            minY = 0,
            maxY = height,
        } = options;
        const horizontalPadding = 7;
        const labelHeight = 20;
        const textWidth = ctx.measureText(text).width;
        const labelWidth = textWidth + horizontalPadding * 2;
        let left = align === 'center' ? x - labelWidth / 2 : x;
        let top = y - labelHeight / 2;

        left = Math.max(minX, Math.min(maxX - labelWidth, left));
        top = Math.max(minY, Math.min(maxY - labelHeight, top));

        ctx.fillStyle = background;
        ctx.fillRect(left, top, labelWidth, labelHeight);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
        ctx.strokeRect(left + 0.5, top + 0.5, labelWidth - 1, labelHeight - 1);
        ctx.fillStyle = color;
        ctx.fillText(text, left + horizontalPadding, top + 14);
    };

    const xForIndex = (index) => padding.left + candleGap * index + candleGap / 2;

    const drawSeriesLine = (series, color, lineWidth = 1.4, yMapper = yForPrice) => {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        let started = false;

        series.forEach((value, index) => {
            if (!Number.isFinite(value)) {
                started = false;
                return;
            }

            const x = xForIndex(index);
            const y = yMapper(value);
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();
        ctx.restore();
    };

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
        const y = padding.top + (priceHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        const price = maxPrice - (priceRange / 4) * i;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px Noto Sans KR, sans-serif';
        ctx.fillText(Math.round(price).toLocaleString('ko-KR'), width - padding.right + 8, y + 4);
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, priceBottom + chartSectionGap / 2);
    ctx.lineTo(width - 8, priceBottom + chartSectionGap / 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px Noto Sans KR, sans-serif';
    for (let i = 0; i <= 2; i += 1) {
        const ratio = i / 2;
        const volume = maxVolume * (1 - ratio);
        const y = volumeTop + volumeHeight * ratio;

        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();
        ctx.fillText(formatVolumeAxis(volume), width - padding.right + 8, y + 4);
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(padding.left, padding.top, plotWidth, priceHeight);
    ctx.clip();

    candles.forEach((candle, index) => {
        const x = xForIndex(index);
        const openY = yForPrice(candle.open);
        const closeY = yForPrice(candle.close);
        const highY = yForPrice(candle.high);
        const lowY = yForPrice(candle.low);
        const isUp = candle.close >= candle.open;
        const color = isUp ? '#ef4444' : '#3b82f6';
        const top = Math.min(openY, closeY);
        const bodyHeight = Math.max(1, Math.abs(closeY - openY));

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, highY);
        ctx.lineTo(x, lowY);
        ctx.stroke();
        ctx.fillRect(x - bodyWidth / 2, top, bodyWidth, bodyHeight);
    });

    const sharedContext = {
        ctx,
        width,
        height,
        padding,
        candles,
        closes,
        bodyWidth,
        xForIndex,
        drawSeriesLine,
    };

    overlayIndicators.forEach((indicator) => {
        getIndicatorDefinition(indicator.key)?.drawOverlay?.(indicator, sharedContext);
    });

    ctx.restore();

    candles.forEach((candle, index) => {
        const x = xForIndex(index);
        const isUp = candle.close >= candle.open;
        const volumeHeightPx = ((candle.volume || 0) / maxVolume) * volumeHeight;
        ctx.fillStyle = isUp ? 'rgba(239, 68, 68, 0.35)' : 'rgba(59, 130, 246, 0.35)';
        ctx.fillRect(x - bodyWidth / 2, height - padding.bottom - volumeHeightPx, bodyWidth, volumeHeightPx);
    });

    lowerIndicators.forEach((indicator, panelIndex) => {
        const top = firstLowerPanelTop + indicatorPanelHeight * panelIndex;
        const bottom = top + indicatorPanelHeight - 8;
        const panel = {
            top,
            bottom,
            height: bottom - top,
        };

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding.left, top);
        ctx.lineTo(width - padding.right, top);
        ctx.stroke();

        ctx.fillStyle = '#94a3b8';
        ctx.font = '11px Noto Sans KR, sans-serif';
        getIndicatorDefinition(indicator.key)?.drawPanel?.(indicator, {
            ...sharedContext,
            panel,
        });
    });

    const first = candles[0]?.time || '';
    const last = candles[candles.length - 1]?.time || '';
    ctx.fillStyle = '#64748b';
    ctx.font = '11px Noto Sans KR, sans-serif';
    ctx.fillText(formatChartTime(first, currentChartInterval, true), padding.left, height - 16);
    ctx.fillText(formatChartTime(last, currentChartInterval, true), Math.max(padding.left, width - padding.right - 96), height - 16);

    if (!chartHoverPoint) return;

    const hoverX = Math.max(padding.left, Math.min(width - padding.right, chartHoverPoint.x));
    const hoverY = Math.max(padding.top, Math.min(height - padding.bottom, chartHoverPoint.y));
    const hoverIndex = Math.max(0, Math.min(candles.length - 1, Math.floor((hoverX - padding.left) / candleGap)));
    const hoverCandle = candles[hoverIndex];
    const snappedX = padding.left + candleGap * hoverIndex + candleGap / 2;
    const isInPriceArea = hoverY >= padding.top && hoverY <= priceBottom;
    const isInVolumeArea = hoverY >= volumeTop && hoverY <= height - padding.bottom;

    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.42)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(snappedX, padding.top);
    ctx.lineTo(snappedX, height - padding.bottom);
    ctx.stroke();

    if (isInPriceArea || isInVolumeArea) {
        ctx.beginPath();
        ctx.moveTo(padding.left, hoverY);
        ctx.lineTo(width - padding.right, hoverY);
        ctx.stroke();
    }
    ctx.restore();

    ctx.font = '11px Noto Sans KR, sans-serif';

    if (isInPriceArea) {
        const price = Math.max(0, Math.round(priceForY(hoverY)));
        drawAxisLabel(price.toLocaleString('ko-KR'), width - padding.right + 3, hoverY, {
            maxX: width,
            minY: padding.top,
            maxY: priceBottom,
            background: '#0f766e',
            color: '#ffffff',
        });
    }

    if (isInVolumeArea) {
        const volume = Math.round(volumeForY(hoverY));
        drawAxisLabel(volume.toLocaleString('ko-KR'), width - padding.right + 3, hoverY, {
            maxX: width,
            minY: volumeTop,
            maxY: height - padding.bottom,
            background: '#334155',
            color: '#f8fafc',
        });
    }

    drawAxisLabel(formatChartTime(hoverCandle?.time), snappedX, height - 16, {
        align: 'center',
        minX: padding.left,
        maxX: width - padding.right,
        minY: height - padding.bottom + 2,
        maxY: height,
        background: '#0f172a',
        color: '#f8fafc',
    });
};
