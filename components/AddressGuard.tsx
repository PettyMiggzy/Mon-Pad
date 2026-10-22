import { v3Configured } from '@/lib/constants';
import { DEMO_BOARD } from '@/lib/demo';

export function AddressGuard() {
  // The red ".env.local" strip is a local reminder. On the public demo
  // (factory unset) it sits on top of the site and looks like a broken deploy.
  if (v3Configured() || DEMO_BOARD || process.env.NODE_ENV === 'production') return null;
  return (
    <div
      role="alert"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 60,
        background: 'rgba(239, 68, 68, 0.95)',
        color: '#fff',
        textAlign: 'center',
        padding: '6px 16px',
        fontSize: '13px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        borderBottom: '1px solid rgba(127, 29, 29, 1)',
      }}
    >
      {'\u26A0'} CONTRACT ADDRESSES NOT SET {'\u2014'} edit{' '}
      <code style={{ background: 'rgba(0,0,0,0.25)', padding: '0 4px', borderRadius: 2 }}>.env.local</code>{' '}
      after mainnet deploy. All on-chain reads will fail until configured.
    </div>
  );
}

export default AddressGuard;
