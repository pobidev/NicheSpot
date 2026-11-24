import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import { IconMusic, IconSpinner } from '../components/Icons';

export default function Login() {
  const { login } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', display_name: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = isRegister
        ? await api.register({ username: form.username, password: form.password, display_name: form.display_name })
        : await api.login({ username: form.username, password: form.password });
      login(data.token, data.user);
    } catch (err) {
      setError(err.message || 'Error al conectar');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-page text-main flex items-center justify-center p-4 transition-colors duration-200">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-primarysubtle text-primary flex items-center justify-center shadow-xs border border-primary/20">
            <IconMusic className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-extrabold text-main tracking-tight">NichoSpot</h1>
          <p className="text-muted text-xs mt-1">Comparte y valora música con tus amigos</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card border border-borderc/60 rounded-2xl p-6 shadow-xl space-y-4">
          <h2 className="text-base font-bold text-main text-center">
            {isRegister ? 'Crear nueva cuenta' : 'Iniciar sesión'}
          </h2>

          {error && (
            <div className="bg-red-500/15 border border-red-500/30 rounded-xl p-3 text-red-400 text-xs text-center font-medium">
              {error}
            </div>
          )}

          {isRegister && (
            <div>
              <label className="text-xs text-muted block mb-1 font-medium">Nombre visible</label>
              <input
                name="display_name"
                value={form.display_name}
                onChange={handleChange}
                placeholder="Ej: Laura Martínez"
                required
                className="w-full bg-inputbg border border-borderc rounded-xl p-3 text-main placeholder-muted text-xs focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          )}

          <div>
            <label className="text-xs text-muted block mb-1 font-medium">Usuario</label>
            <input
              name="username"
              value={form.username}
              onChange={handleChange}
              placeholder="tu_usuario"
              required
              className="w-full bg-inputbg border border-borderc rounded-xl p-3 text-main placeholder-muted text-xs focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <div>
            <label className="text-xs text-muted block mb-1 font-medium">Contraseña</label>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              placeholder="••••••••"
              required
              className="w-full bg-inputbg border border-borderc rounded-xl p-3 text-main placeholder-muted text-xs focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-primary hover:bg-primaryhover text-white text-xs font-bold transition-all active:scale-[0.98] shadow-xs disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <IconSpinner className="w-4 h-4 text-white" />
                <span>Cargando...</span>
              </>
            ) : isRegister ? (
              'Registrarse'
            ) : (
              'Entrar'
            )}
          </button>

          <div className="text-center pt-2 border-t border-borderc/40">
            <button
              type="button"
              onClick={() => { setIsRegister(!isRegister); setError(''); }}
              className="text-xs text-primary hover:text-primaryhover font-medium transition-colors"
            >
              {isRegister ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Crear cuenta'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
