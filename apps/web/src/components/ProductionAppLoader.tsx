import { Suspense, lazy, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { LazyLoadBoundary } from "./LazyLoadBoundary.js";

interface ProductionAppModule {
  readonly ProductionApp: ComponentType;
}

export type ProductionAppModuleLoader = () => Promise<ProductionAppModule>;

const loadProductionAppDefault: ProductionAppModuleLoader = () =>
  import("../ProductionApp.js");
const DefaultLazyProductionApp = lazy(async () => {
  const module = await loadProductionAppDefault();
  return { default: module.ProductionApp };
});

interface Props {
  readonly component?: ComponentType;
  readonly onReload?: () => void;
}

export function ProductionAppLoader({
  component: AppComponent = DefaultLazyProductionApp,
  onReload = () => window.location.reload(),
}: Props) {
  const { t } = useTranslation();
  return (
    <LazyLoadBoundary
      fallback={
        <div role="alert">
          <p>{t("app.loadFailed")}</p>
          <button type="button" onClick={onReload}>
            {t("action.retry")}
          </button>
        </div>
      }
    >
      <Suspense fallback={<div role="status">{t("app.loading")}</div>}>
        <AppComponent />
      </Suspense>
    </LazyLoadBoundary>
  );
}
