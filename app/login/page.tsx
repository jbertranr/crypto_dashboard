"use client";
import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router   = useRouter();
  const [user, setUser]        = useState("");
  const [pw, setPw]            = useState("");
  const [error, setError]      = useState("");
  const [loading, setLoading]  = useState(false);
  const [showPw, setShowPw]    = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user, password: pw }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const d = await res.json() as { error: string };
        setError(d.error ?? "Error desconegut");
        setPw("");
      }
    } catch {
      setError("Error de connexió");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-bg">
      <div className="login-card">

        {/* Logo */}
        <div className="login-card__logo">
          <svg width="36" height="36" viewBox="0 0 22 22" fill="none">
            <path d="M11 2L19.5 7V15L11 20L2.5 15V7L11 2Z" fill="url(#lg)" />
            <path d="M7.5 11.5L10 14L14.5 9" stroke="white" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round"/>
            <defs>
              <linearGradient id="lg" x1="2.5" y1="2" x2="19.5" y2="20" gradientUnits="userSpaceOnUse">
                <stop stopColor="#6366f1"/>
                <stop offset="1" stopColor="#8b5cf6"/>
              </linearGradient>
            </defs>
          </svg>
        </div>

        <h1 className="login-card__title">CryptDesk</h1>
        <p className="login-card__sub">Introdueix la contrasenya per accedir</p>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-form__field">
            <label className="login-form__label">Usuari</label>
            <div className="login-form__input-wrap">
              <i className="fa-solid fa-user login-form__icon" />
              <input
                type="text"
                className={`login-form__input${error ? " login-form__input--err" : ""}`}
                value={user}
                onChange={e => { setUser(e.target.value); setError(""); }}
                placeholder="usuari"
                autoFocus
                autoComplete="username"
              />
            </div>
          </div>

          <div className="login-form__field">
            <label className="login-form__label">Contrasenya</label>
            <div className="login-form__input-wrap">
              <i className="fa-solid fa-lock login-form__icon" />
              <input
                type={showPw ? "text" : "password"}
                className={`login-form__input${error ? " login-form__input--err" : ""}`}
                value={pw}
                onChange={e => { setPw(e.target.value); setError(""); }}
                placeholder="••••••••"
                autoFocus
                autoComplete="current-password"
              />
              <button type="button" className="login-form__toggle"
                onClick={() => setShowPw(v => !v)}
                tabIndex={-1}>
                <i className={`fa-solid ${showPw ? "fa-eye-slash" : "fa-eye"}`} />
              </button>
            </div>
            {error && (
              <div className="login-form__error">
                <i className="fa-solid fa-circle-exclamation" /> {error}
              </div>
            )}
          </div>

          <button type="submit" className="login-form__submit" disabled={loading || !pw || !user}>
            {loading
              ? <><i className="fa-solid fa-spinner fa-spin" /> Verificant…</>
              : <><i className="fa-solid fa-arrow-right-to-bracket" /> Accedir</>
            }
          </button>
        </form>

        <p className="login-card__footer">Binance Demo · Testnet</p>
      </div>
    </div>
  );
}
