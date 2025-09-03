import { useEffect, useMemo, useState } from 'react';
import { detectPlatform, isElectronRuntime } from '../utils/env';
import '../../css/DownloadElectronCTA.css';

type Props = {
    hideIfElectron?: boolean;
};

export default function DownloadElectronCTA({ hideIfElectron = true }: Props) {
    const [isDismissed, setIsDismissed] = useState(false);
    const [visible, setVisible] = useState(false);
    const platform = useMemo(() => detectPlatform(), []);

    useEffect(() => {
        const dismissed = localStorage.getItem('downloadElectronDismissed');
        if (dismissed === 'true') {
            setIsDismissed(true);
        }
        const shouldHide = hideIfElectron && isElectronRuntime();
        setVisible(!shouldHide);
    }, [hideIfElectron]);

    if (!visible || isDismissed) return null;

    const label = (() => {
        switch (platform) {
            case 'mac':
                return 'Download for macOS';
            case 'win':
                return 'Download for Windows';
            case 'linux':
                return 'Download for Linux';
            default:
                return 'Download Desktop App';
        }
    })();

    // If GitHub Releases are configured, we can deep-link to the latest assets.
    // Using predictable artifact names from electron-builder's artifactName.
    const owner = 'hytopiagg';
    const repo = 'world-editor';
    const latestBase = `https://github.com/${owner}/${repo}/releases/latest/download`;
    const assetForPlatform = (() => {
        switch (platform) {
            case 'mac':
                // Universal .dmg preferred for macOS
                return 'Hytopia-World-Editor-mac-x64.dmg';
            case 'win':
                return 'Hytopia-World-Editor-win-x64.exe';
            case 'linux':
                return 'Hytopia-World-Editor-linux-x64.AppImage';
            default:
                return '';
        }
    })();
    const href = assetForPlatform ? `${latestBase}/${assetForPlatform}` : `https://github.com/${owner}/${repo}#desktop-app-electron`;

    return (
        <div className="download-electron-cta">
            <div className="cta-bubble">
                <div className="cta-title">Get the Desktop App</div>
                <div className="cta-subtitle">Faster and smoother on your machine.</div>
                <div className="cta-actions">
                    <a className="cta-button" href={href} target="_blank" rel="noreferrer">
                        {label}
                    </a>
                    <button
                        className="cta-dismiss"
                        onClick={() => {
                            localStorage.setItem('downloadElectronDismissed', 'true');
                            setIsDismissed(true);
                        }}
                    >
                        Dismiss
                    </button>
                </div>
            </div>
        </div>
    );
}


