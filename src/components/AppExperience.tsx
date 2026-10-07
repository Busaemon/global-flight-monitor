import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, RefreshCw, WifiOff } from 'lucide-react';
import { applyPwaUpdate, getPwaState, installPwa, subscribePwa } from '../pwa';

export default function AppExperience() {
  const pwa = useSyncExternalStore(subscribePwa, getPwaState, getPwaState);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const updateConnection = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  const showGuide = !pwa.installed;
  if (online && !pwa.updateAvailable && !pwa.registrationFailed && !pwa.installFailed && !showGuide) return null;

  return (
    <aside className="app-experience" aria-label="アプリと接続の案内">
      <div className="app-experience__status" role="status" aria-live="polite" aria-atomic="true">
        {!online && <p><WifiOff size={16} aria-hidden="true" />オフラインです。新しい航空機データは取得できません。表示中の観測日時を確認してください。</p>}
        {pwa.updateAvailable && <p>アプリの更新を利用できます。更新するとページを再読み込みします。</p>}
        {pwa.updateFailed && <p>更新できませんでした。接続を確認して、もう一度お試しください。</p>}
        {pwa.registrationFailed && <p>ホーム画面アプリの準備が完了しませんでした。ブラウザーでの閲覧は続けられます。</p>}
        {pwa.installFailed && <p>アプリを追加できませんでした。ブラウザーのメニューからホーム画面への追加をお試しください。</p>}
      </div>
      <div className="app-experience__actions">
        {pwa.updateAvailable && <button className="secondary-button" type="button" onClick={applyPwaUpdate} disabled={pwa.updating}>
          <RefreshCw size={16} aria-hidden="true" />{pwa.updating ? '更新しています…' : '更新して再読み込み'}
        </button>}
        {pwa.canInstall && !pwa.installed && <button className="secondary-button" type="button" onClick={() => { void installPwa(); }}>
          <Download size={16} aria-hidden="true" />ホーム画面に追加
        </button>}
        {showGuide && <details className="app-experience__guide">
          <summary>スマートフォンでアプリとして使う</summary>
          <p>iPhone・iPad は Safari の共有メニューから「ホーム画面に追加」を選びます。Android は対応ブラウザーのメニューで「アプリをインストール」または「ホーム画面に追加」を選びます。</p>
          <p>HTTPS で公開されたサイトで利用できます。オフラインで開けるのはアプリの画面です。最新の航空機情報にはインターネット接続が必要です。</p>
        </details>}
      </div>
    </aside>
  );
}
