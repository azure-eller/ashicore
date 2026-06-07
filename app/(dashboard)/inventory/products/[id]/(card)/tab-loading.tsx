import { Spinner } from "@/components/ui/spinner";
import styles from "@/components/card-page/card-page.module.css";

export default function ProductCardTabLoading() {
  return (
    <div className={styles.tabLoading} role="status" aria-live="polite">
      <Spinner className="size-5" />
    </div>
  );
}
