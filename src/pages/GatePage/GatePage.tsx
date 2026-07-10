import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, Shield, Loader2, AlertTriangle } from 'lucide-react';
import type { QortiumAccount } from '../../types';
import { getSelectedAccount } from '../../services/qortium/accountService';
import { hasQortiumBridge } from '../../services/qortium/qortiumClient';
import bgMountains from '../../assets/backgrounds/01-mountains.jpg';
import bgOcean from '../../assets/backgrounds/02-ocean.jpg';
import bgForestFog from '../../assets/backgrounds/03-forest-fog.jpg';
import bgForestLight from '../../assets/backgrounds/04-forest-light.jpg';
import bgNaturePath from '../../assets/backgrounds/05-nature-path.jpg';
import bgLake from '../../assets/backgrounds/06-lake.jpg';
import './GatePage.css';

/* Local background images — bundled with the app, no external requests */
const BACKGROUNDS = [
  bgMountains,
  bgOcean,
  bgForestFog,
  bgForestLight,
  bgNaturePath,
  bgLake,
];

interface GatePageProps {
  onAccountReady: (account: QortiumAccount) => void;
}

export default function GatePage({ onAccountReady }: GatePageProps) {
  const navigate = useNavigate();
  const [bgUrl] = useState(() => BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)]);
  const [isEntering, setIsEntering] = useState(false);
  const [error, setError] = useState('');
  const [isBridgeAvailable, setIsBridgeAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    setIsBridgeAvailable(hasQortiumBridge());
  }, []);

  const handleEnter = useCallback(async () => {
    setIsEntering(true);
    setError('');

    try {
      const account = await getSelectedAccount();

      if (!account.address) {
        setError('No Qortium account selected. Please select an account in Qortium Home first.');
        return;
      }

      onAccountReady(account);
      navigate('/dashboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect.';
      if (message.includes('not shared') || message.includes('Account access was not shared')) {
        setError('Please approve account access in the Qortium Home dialog.');
      } else if (message.includes('No account is selected')) {
        setError('No account is selected. Please unlock and select an account in Qortium Home.');
      } else {
        setError(message);
      }
    } finally {
      setIsEntering(false);
    }
  }, [navigate, onAccountReady]);

  return (
    <div className="gate">
      <div
        className="gate__background"
        style={{ backgroundImage: `url(${bgUrl})` }}
        aria-hidden="true"
      />
      <div className="gate__overlay" />

      <div className="gate__content">
        <div className="gate__card">
          <div className="gate__icon">
            <Shield size={48} strokeWidth={1.5} />
          </div>

          <h1 className="gate__title">My File Office</h1>
          <p className="gate__tagline">
            Your personal file vault on the Qortium network.
            Only you can see what's inside.
          </p>

          {isBridgeAvailable === false && (
            <div className="gate__warning">
              <AlertTriangle size={18} />
              <span>This app must be opened inside Qortium Home.</span>
            </div>
          )}

          {error && (
            <div className="gate__error" role="alert">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}

          <button
            className="gate__enter-btn"
            onClick={handleEnter}
            disabled={isEntering || isBridgeAvailable === false}
            type="button"
          >
            {isEntering ? (
              <>
                <Loader2 size={20} className="gate__spinner" />
                Connecting...
              </>
            ) : (
              <>
                <LogIn size={20} />
                Enter Room
              </>
            )}
          </button>

          <p className="gate__hint">
            Your identity is verified through your Qortium account.
            All files are visible only to you.
          </p>
        </div>
      </div>
    </div>
  );
}
