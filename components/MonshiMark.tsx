'use client';

import dynamic from 'next/dynamic';

/** Client-only 3D Monshi mark for header / brand strip. */
const MonshiMark3D = dynamic(() => import('./MonshiMark3D'), {
  ssr: false,
  loading: () => (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/meshy/monshi-mascot.png"
      alt="Monshi"
      width={44}
      height={44}
      draggable={false}
      style={{
        width: 44,
        height: 44,
        objectFit: 'contain',
        filter: 'drop-shadow(0 6px 16px rgba(181,123,255,0.45))',
      }}
    />
  ),
});

export default function MonshiMark({
  size = 44,
  spin = true,
  className,
}: {
  size?: number;
  spin?: boolean;
  className?: string;
}) {
  return <MonshiMark3D size={size} spin={spin} className={className} />;
}
