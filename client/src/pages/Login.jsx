import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import * as api from '../api';
import {
  IconMusic,
  IconSpinner,
  IconDisc,
  IconPalette,
  IconClose,
  IconCheck,
} from '../components/Icons';

export default function Login() {
  const { login } = useAuth();
  const { theme, setTheme, themes } = useTheme();

  const [isRegister, setIsRegister] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', display_name: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [themeModalOpen, setThemeModalOpen] = useState(false);

  useEffect(() => {
    if (!themeModalOpen) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setThemeModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [themeModalOpen]);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    if (error) setError('');
  };

  const switchMode = (registerMode) => {
    if (isRegister === registerMode) return;
    setIsRegister(registerMode);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cleanUsername = form.username.trim();
    const cleanDisplayName = form.display_name.trim();

    if (!cleanUsername || !form.password) {
      setError('Completa usuario y contraseña.');
      return;
    }

    if (isRegister && form.password.length < 4) {
      setError('La contraseña debe tener al menos 4 caracteres.');
      return;
    }

    setError('');
    setLoading(true);
    try {
      const data = isRegister
        ? await api.register({
            username: cleanUsername,
            password: form.password,
            display_name: cleanDisplayName || cleanUsername,
          })
        : await api.login({
            username: cleanUsername,
            password: form.password,
          });
      login(data.token, data.user);
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión');
    } finally {
      setLoading(false);
    }
  };

  const activeThemeObj = themes.find((t) => t.id === theme);
  const darkThemes = themes.filter((t) => t.group !== 'light');
  const lightThemes = themes.filter((t) => t.group === 'light');

  return (
    <div className="relative min-h-screen bg-page text-main flex flex-col items-center justify-center p-4">
      {/* Botón selector de tema en esquina superior derecha */}
      <button
        type="button"
        onClick={() => setThemeModalOpen(true)}
        className="fixed top-4 right-4 z-20 px-3 py-1.5 rounded-xl bg-card hover:bg-cardhover border border-borderc text-main text-xs font-semibold shadow-sm transition-all active:scale-95 flex items-center gap-2"
        title="Cambiar tema visual"
      >
        <IconPalette className="w-3.5 h-3.5 text-primary" />
        <span>{activeThemeObj?.name || 'Tema'}</span>
      </button>

      <div className="w-full max-w-sm space-y-6 animate-fade-up">
        {/* Marca */}
        <div className="text-center space-y-2">
          <div className="relative w-16 h-16 mx-auto rounded-2xl bg-primarysubtle text-primary border border-primary flex items-center justify-center shadow-md">
            <IconDisc className="w-8 h-8" />
            <span className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-lg bg-primary text-white flex items-center justify-center shadow-xs">
              <IconMusic className="w-3.5 h-3.5" />
            </span>
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-main tracking-tight">NichoSpot</h1>
            <p className="text-muted text-xs mt-0.5">
              Registra tus discos, puntúalos y compártelos con amigos
            </p>
          </div>
        </div>

        {/* Tarjeta de acceso */}
        <div className="bg-card border border-borderc rounded-2xl p-5 shadow-xl space-y-4">
          {/* Selector de modo */}
          <div className="p-1 bg-inputbg rounded-xl border border-borderc grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => switchMode(false)}
              className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                !isRegister
                  ? 'bg-primary text-white shadow-xs font-bold'
                  : 'text-muted hover:text-main'
              }`}
            >
              Iniciar sesión
            </button>
            <button
              type="button"
              onClick={() => switchMode(true)}
              className={`py-2 rounded-lg text-xs font-semibold transition-all ${
                isRegister
                  ? 'bg-primary text-white shadow-xs font-bold'
                  : 'text-muted hover:text-main'
              }`}
            >
              Crear cuenta
            </button>
          </div>

          {error && (
            <div className="bg-red-500/15 border border-red-500/30 rounded-xl p-2.5 text-red-400 text-xs text-center font-medium animate-fade-up">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5">
            {isRegister && (
              <div className="animate-fade-up">
                <label className="text-xs text-muted block mb-1 font-medium">
                  Nombre visible
                </label>
                <input
                  name="display_name"
                  type="text"
                  autoComplete="name"
                  value={form.display_name}
                  onChange={handleChange}
                  placeholder="Ej: Laura Martínez"
                  required
                  className="w-full bg-inputbg border border-borderc rounded-xl px-3.5 py-2.5 text-main placeholder-muted text-xs focus:outline-none focus:border-primary"
                />
              </div>
            )}

            <div>
              <label className="text-xs text-muted block mb-1 font-medium">Usuario</label>
              <input
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                value={form.username}
                onChange={handleChange}
                placeholder="tu_usuario"
                required
                className="w-full bg-inputbg border border-borderc rounded-xl px-3.5 py-2.5 text-main placeholder-muted text-xs focus:outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="text-xs text-muted block mb-1 font-medium">Contraseña</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  value={form.password}
                  onChange={handleChange}
                  placeholder="••••••••"
                  required
                  className="w-full bg-inputbg border border-borderc rounded-xl pl-3.5 pr-16 py-2.5 text-main placeholder-muted text-xs focus:outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-muted hover:text-main px-1.5 py-0.5 rounded-md"
                >
                  {showPassword ? 'Ocultar' : 'Mostrar'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold transition-all active:scale-[0.98] shadow-xs disabled:opacity-50 flex items-center justify-center gap-2 mt-1"
            >
              {loading ? (
                <>
                  <IconSpinner className="w-4 h-4 text-white" />
                  <span>{isRegister ? 'Creando cuenta...' : 'Entrando...'}</span>
                </>
              ) : isRegister ? (
                'Crear cuenta y entrar'
              ) : (
                'Entrar'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-muted">
          {isRegister
            ? 'Podrás conectar tu cuenta de Last.fm desde tu perfil.'
            : '¿Primera vez por aquí? Cambia a la pestaña Crear cuenta.'}
        </p>
      </div>

      {/* Modal selector de temas */}
      {themeModalOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-backdrop-in"
            onClick={(e) => {
              if (e.target === e.currentTarget) setThemeModalOpen(false);
            }}
          >
            <div
              className="relative w-full max-w-sm rounded-2xl bg-card border border-borderc p-5 shadow-2xl space-y-4 animate-modal-in"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-main flex items-center gap-2">
                  <IconPalette className="w-4 h-4 text-primary" />
                  <span>Apariencia y tema</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setThemeModalOpen(false)}
                  className="text-muted hover:text-main p-1 rounded-lg hover:bg-cardhover transition-colors"
                  aria-label="Cerrar selector de temas"
                >
                  <IconClose className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">
                    Temas oscuros
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {darkThemes.map((t) => {
                      const isSelected = theme === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTheme(t.id)}
                          className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-left transition-all active:scale-[0.97] ${
                            isSelected
                              ? 'border-primary bg-primarysubtle text-main font-semibold'
                              : 'border-borderc bg-inputbg hover:bg-cardhover text-main'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-3.5 h-3.5 rounded-full flex-shrink-0 border border-borderc"
                              style={{ backgroundColor: t.color }}
                            />
                            <span className="text-xs truncate">{t.name}</span>
                          </div>
                          {isSelected && <IconCheck className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-bold text-muted uppercase tracking-wider mb-2">
                    Temas claros
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {lightThemes.map((t) => {
                      const isSelected = theme === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTheme(t.id)}
                          className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-left transition-all active:scale-[0.97] ${
                            isSelected
                              ? 'border-primary bg-primarysubtle text-main font-semibold'
                              : 'border-borderc bg-inputbg hover:bg-cardhover text-main'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-3.5 h-3.5 rounded-full flex-shrink-0 border border-borderc"
                              style={{ backgroundColor: t.color }}
                            />
                            <span className="text-xs truncate">{t.name}</span>
                          </div>
                          {isSelected && <IconCheck className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setThemeModalOpen(false)}
                className="w-full py-2.5 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-semibold transition-all active:scale-[0.98] shadow-xs"
              >
                Listo
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}