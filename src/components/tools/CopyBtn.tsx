import React, { useState } from 'react';
import { copyBtnS } from './toolStyles';

const CopyBtn = React.memo(function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button style={copyBtnS} onClick={() => { void navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}>
      {ok ? '✓' : '📋'}
    </button>
  );
});

export default CopyBtn;
