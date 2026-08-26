import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { LineChart, Loader2 } from 'lucide-react';

/**
 * Gates the app behind Supabase Auth.
 *
 * The desktop build had no concept of a user -- the database was a file only
 * you could reach. On the public web that guarantee has to come from
 * somewhere, so every table is protected by Row Level Security keyed on
 * auth.uid(), and nothing renders until we have a session.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
            setChecking(false);
        });

        const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
            setSession(next);
        });
        return () => sub.subscription.unsubscribe();
    }, []);

    if (checking) {
        return (
            <div style={styles.centered}>
                <Loader2 size={28} className="spin" style={{ color: 'var(--text-secondary)' }} />
            </div>
        );
    }

    if (!session) return <SignInScreen />;

    return <>{children}</>;
}

function SignInScreen() {
    const [mode, setMode] = useState<'signin' | 'signup'>('signin');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        setNotice(null);

        try {
            if (mode === 'signup') {
                const { data, error } = await supabase.auth.signUp({ email, password });
                if (error) throw error;
                // With email confirmation on, there's no session yet.
                if (!data.session) {
                    setNotice('Check your inbox to confirm your address, then sign in.');
                    setMode('signin');
                }
            } else {
                const { error } = await supabase.auth.signInWithPassword({ email, password });
                if (error) throw error;
            }
        } catch (err: any) {
            setError(err?.message || 'Something went wrong.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div style={styles.centered}>
            <form onSubmit={submit} style={styles.card}>
                <div style={styles.brand}>
                    <LineChart size={22} style={{ color: 'var(--accent)' }} />
                    <span style={styles.brandText}>TradeSlate</span>
                </div>

                <p style={styles.subtitle}>
                    {mode === 'signin' ? 'Sign in to your journal.' : 'Create your journal.'}
                </p>

                <label style={styles.label}>
                    Email
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        style={styles.input}
                    />
                </label>

                <label style={styles.label}>
                    Password
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        minLength={8}
                        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                        style={styles.input}
                    />
                </label>

                {error && <div style={styles.error}>{error}</div>}
                {notice && <div style={styles.notice}>{notice}</div>}

                <button type="submit" disabled={busy} style={styles.submit}>
                    {busy ? 'Working...' : mode === 'signin' ? 'Sign in' : 'Create account'}
                </button>

                <button
                    type="button"
                    onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
                    style={styles.toggle}
                >
                    {mode === 'signin'
                        ? "Don't have an account? Sign up"
                        : 'Already have an account? Sign in'}
                </button>
            </form>
        </div>
    );
}

const styles: Record<string, React.CSSProperties> = {
    centered: {
        height: '100vh',
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
    },
    card: {
        width: '100%',
        maxWidth: 380,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 28,
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        backgroundColor: 'var(--bg-secondary)',
    },
    brand: { display: 'flex', alignItems: 'center', gap: 8 },
    brandText: { fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' },
    subtitle: { margin: 0, color: 'var(--text-secondary)', fontSize: 13 },
    label: {
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        fontSize: 12,
        color: 'var(--text-secondary)',
    },
    input: {
        padding: '9px 11px',
        borderRadius: 6,
        border: '1px solid var(--border)',
        backgroundColor: 'var(--bg-tertiary)',
        color: 'var(--text-primary)',
        fontSize: 14,
        outline: 'none',
    },
    submit: {
        marginTop: 4,
        padding: '10px 12px',
        borderRadius: 6,
        border: 'none',
        backgroundColor: 'var(--accent)',
        color: '#052e16',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
    },
    toggle: {
        background: 'none',
        border: 'none',
        color: 'var(--text-secondary)',
        fontSize: 12,
        cursor: 'pointer',
        padding: 0,
    },
    error: {
        padding: '8px 10px',
        borderRadius: 6,
        backgroundColor: 'var(--danger-glow)',
        color: 'var(--danger)',
        fontSize: 12,
    },
    notice: {
        padding: '8px 10px',
        borderRadius: 6,
        backgroundColor: 'var(--accent-glow)',
        color: 'var(--accent)',
        fontSize: 12,
    },
};
