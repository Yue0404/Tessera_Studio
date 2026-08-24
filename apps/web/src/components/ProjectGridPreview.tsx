import { cellPolygon, type GridType } from "@tessera/core";
import { useTranslation } from "react-i18next";
import styles from "./NewProjectDialog.module.css";

interface Props {
  readonly gridType: GridType;
  readonly width: number;
  readonly height: number;
  readonly cellSize: number;
  readonly background: string;
  readonly cellColor: string;
  readonly gridColor: string;
  readonly gridOpacity: number;
  readonly gridWidth: number;
}

/** 仅绘制固定数量示例格，输入 40000×40000 时也不会按地图面积分配。 */
export function ProjectGridPreview(props: Props) {
  const { t } = useTranslation();
  const rows = Math.max(1, Math.min(3, props.height));
  const columns = Math.max(1, Math.min(4, props.width));
  const grid = {
    type: props.gridType,
    width: columns,
    height: rows,
    cellSize: Math.max(12, Math.min(96, props.cellSize)),
  } as const;
  const polygons = Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    return cellPolygon(grid, row, column);
  });
  const points = polygons.flat();
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const padding = grid.cellSize * 0.2;
  return (
    <figure className={styles.preview} data-testid="project-grid-preview">
      <svg
        role="img"
        aria-label={t("new.previewLabel", {
          grid: t(
            props.gridType === "square" ? "grid.square" : "grid.hexPointy",
          ),
          width: props.width,
          height: props.height,
        })}
        data-grid-type={props.gridType}
        data-map-width={props.width}
        data-map-height={props.height}
        viewBox={`${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`}
        style={{ backgroundColor: props.background }}
      >
        {polygons.map((polygon, index) => (
          <polygon
            key={index}
            points={polygon.map((point) => `${point.x},${point.y}`).join(" ")}
            fill={props.cellColor}
            stroke={props.gridColor}
            strokeOpacity={props.gridOpacity}
            strokeWidth={Math.max(0.5, props.gridWidth)}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <figcaption>{t("new.previewCaption")}</figcaption>
    </figure>
  );
}
