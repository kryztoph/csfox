(() => {
    'use strict';

    const root = document.body;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(pointer: fine)');
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    class LiquidBackdrop {
        constructor(canvas) {
            this.canvas = canvas;
            this.gl = null;
            this.program = null;
            this.uniforms = null;
            this.startTime = performance.now();
            this.motion = reduceMotion.matches ? 0 : 0.64;
            this.pointer = { x: 0.5, y: 0.56, tx: 0.5, ty: 0.56 };
            this.frame = null;
        }

        init() {
            if (!this.canvas) return false;

            try {
                this.gl = this.canvas.getContext('webgl', {
                    alpha: false,
                    antialias: false,
                    depth: false,
                    powerPreference: 'high-performance'
                });
                if (!this.gl) throw new Error('WebGL is unavailable');

                const vertex = `
                    attribute vec2 a_position;
                    void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
                `;
                const fragment = `
                    precision highp float;
                    uniform vec2 u_resolution;
                    uniform vec2 u_pointer;
                    uniform float u_time;
                    uniform float u_motion;

                    float hash(vec2 p) {
                        p = fract(p * vec2(123.34, 456.21));
                        p += dot(p, p + 45.32);
                        return fract(p.x * p.y);
                    }

                    float noise(vec2 p) {
                        vec2 i = floor(p);
                        vec2 f = fract(p);
                        f = f * f * (3.0 - 2.0 * f);
                        return mix(
                            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
                            f.y
                        );
                    }

                    float fbm(vec2 p) {
                        float value = 0.0;
                        float amplitude = 0.5;
                        mat2 rotation = mat2(0.8, -0.6, 0.6, 0.8);
                        for (int i = 0; i < 5; i++) {
                            value += amplitude * noise(p);
                            p = rotation * p * 2.03 + 0.17;
                            amplitude *= 0.5;
                        }
                        return value;
                    }

                    void main() {
                        vec2 uv = gl_FragCoord.xy / u_resolution.xy;
                        float aspect = u_resolution.x / u_resolution.y;
                        vec2 p = uv;
                        p.x *= aspect;

                        float time = u_time * (0.025 + u_motion * 0.055);
                        vec2 warp = vec2(
                            fbm(p * 1.28 + vec2(time, 0.0)),
                            fbm(p * 1.54 + vec2(-time * 0.72, 2.1))
                        );
                        p += (warp - 0.5) * (0.11 + u_motion * 0.1);

                        vec3 color = vec3(0.012, 0.014, 0.029);
                        vec2 blueCenter = vec2(aspect * 0.73 + sin(time) * 0.08, 0.72);
                        vec2 violetCenter = vec2(aspect * 0.86 + cos(time * 1.3) * 0.1, 0.34);
                        vec2 coralCenter = vec2(aspect * 0.36 + sin(time * 0.8) * 0.1, 0.12);
                        vec2 aquaCenter = vec2(aspect * 0.1, 0.48 + cos(time) * 0.09);

                        color += vec3(0.12, 0.31, 0.78) * exp(-length((p - blueCenter) * vec2(0.9, 1.1)) * 3.1) * 0.78;
                        color += vec3(0.4, 0.17, 0.75) * exp(-length((p - violetCenter) * vec2(1.15, 0.9)) * 3.35) * 0.64;
                        color += vec3(0.75, 0.17, 0.12) * exp(-length((p - coralCenter) * vec2(0.9, 1.25)) * 4.1) * 0.38;
                        color += vec3(0.06, 0.62, 0.5) * exp(-length((p - aquaCenter) * vec2(1.2, 0.82)) * 5.0) * 0.24;

                        vec2 pointer = u_pointer;
                        pointer.x *= aspect;
                        color += vec3(0.25, 0.42, 0.8) * exp(-length((p - pointer) * vec2(1.0, 1.2)) * 5.0) * 0.15;

                        float ribbon = sin((p.x * 1.15 + p.y * 1.7 + warp.x * 1.7 - time) * 4.2);
                        ribbon = pow(max(0.0, 1.0 - abs(ribbon)), 12.0);
                        color += vec3(0.2, 0.23, 0.55) * ribbon * 0.22;

                        float vignette = smoothstep(1.16, 0.24, length((uv - 0.5) * vec2(0.82, 1.0)));
                        color *= 0.68 + vignette * 0.36;
                        color += (hash(gl_FragCoord.xy + u_time) - 0.5) / 255.0;
                        gl_FragColor = vec4(pow(color, vec3(0.92)), 1.0);
                    }
                `;

                const vertexShader = this.compile(this.gl.VERTEX_SHADER, vertex);
                const fragmentShader = this.compile(this.gl.FRAGMENT_SHADER, fragment);
                this.program = this.gl.createProgram();
                this.gl.attachShader(this.program, vertexShader);
                this.gl.attachShader(this.program, fragmentShader);
                this.gl.linkProgram(this.program);
                if (!this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) {
                    throw new Error(this.gl.getProgramInfoLog(this.program) || 'Shader link failed');
                }

                const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
                const buffer = this.gl.createBuffer();
                this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
                this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);

                const position = this.gl.getAttribLocation(this.program, 'a_position');
                this.gl.enableVertexAttribArray(position);
                this.gl.vertexAttribPointer(position, 2, this.gl.FLOAT, false, 0, 0);
                this.uniforms = {
                    resolution: this.gl.getUniformLocation(this.program, 'u_resolution'),
                    pointer: this.gl.getUniformLocation(this.program, 'u_pointer'),
                    time: this.gl.getUniformLocation(this.program, 'u_time'),
                    motion: this.gl.getUniformLocation(this.program, 'u_motion')
                };

                this.resize();
                window.addEventListener('resize', () => this.resize(), { passive: true });
                this.frame = requestAnimationFrame((time) => this.render(time));
                document.body.classList.add('has-webgl');
                return true;
            } catch (error) {
                console.warn('CSFOX is using the static liquid fallback:', error.message);
                document.body.classList.add('webgl-fallback');
                this.canvas.hidden = true;
                return false;
            }
        }

        compile(type, source) {
            const shader = this.gl.createShader(type);
            this.gl.shaderSource(shader, source);
            this.gl.compileShader(shader);
            if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
                throw new Error(this.gl.getShaderInfoLog(shader) || 'Shader compilation failed');
            }
            return shader;
        }

        resize() {
            if (!this.gl) return;
            const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
            const width = Math.max(1, Math.floor(window.innerWidth * dpr));
            const height = Math.max(1, Math.floor(window.innerHeight * dpr));
            if (this.canvas.width !== width || this.canvas.height !== height) {
                this.canvas.width = width;
                this.canvas.height = height;
            }
            this.gl.viewport(0, 0, width, height);
        }

        setPointer(clientX, clientY) {
            this.pointer.tx = clamp(clientX / window.innerWidth, 0, 1);
            this.pointer.ty = clamp(1 - clientY / window.innerHeight, 0, 1);
        }

        render(now) {
            if (!this.gl) return;
            const easing = reduceMotion.matches ? 1 : 0.08;
            this.pointer.x += (this.pointer.tx - this.pointer.x) * easing;
            this.pointer.y += (this.pointer.ty - this.pointer.y) * easing;
            const elapsed = reduceMotion.matches ? 0 : (now - this.startTime) / 1000;

            this.gl.useProgram(this.program);
            this.gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
            this.gl.uniform2f(this.uniforms.pointer, this.pointer.x, this.pointer.y);
            this.gl.uniform1f(this.uniforms.time, elapsed);
            this.gl.uniform1f(this.uniforms.motion, this.motion);
            this.gl.drawArrays(this.gl.TRIANGLES, 0, 6);
            this.frame = requestAnimationFrame((time) => this.render(time));
        }
    }

    const canvas = document.querySelector('#liquid-canvas');
    const renderer = new LiquidBackdrop(canvas);
    renderer.init();

    const glassSelectors = [
        '.home-header',
        '.update-card',
        '.card',
        '.portfolio-item',
        '.tech-stack',
        '.about-content',
        '.contact-form'
    ];

    document.querySelectorAll(glassSelectors.join(',')).forEach((element) => {
        element.setAttribute('data-glass', '');
    });

    window.addEventListener('pointermove', (event) => {
        const x = clamp(event.clientX / window.innerWidth, 0, 1);
        const y = clamp(event.clientY / window.innerHeight, 0, 1);
        root.style.setProperty('--pointer-x', `${(x * 100).toFixed(2)}%`);
        root.style.setProperty('--pointer-y', `${(y * 100).toFixed(2)}%`);
        renderer.setPointer(event.clientX, event.clientY);
    }, { passive: true });

    document.querySelectorAll('[data-glass]').forEach((element) => {
        element.addEventListener('pointermove', (event) => {
            const rect = element.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
            const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);
            element.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
            element.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
            element.style.setProperty('--liquid-angle', `${Math.atan2(y - 0.5, x - 0.5) * (180 / Math.PI) + 90}deg`);
        }, { passive: true });
    });

    document.querySelectorAll('[data-tilt]').forEach((element) => {
        element.addEventListener('pointermove', (event) => {
            if (!finePointer.matches || reduceMotion.matches) return;
            const rect = element.getBoundingClientRect();
            const x = (event.clientX - rect.left) / rect.width - 0.5;
            const y = (event.clientY - rect.top) / rect.height - 0.5;
            element.style.setProperty('--tilt-x', `${x * 8}deg`);
            element.style.setProperty('--tilt-y', `${y * -8}deg`);
        }, { passive: true });
        element.addEventListener('pointerleave', () => {
            element.style.setProperty('--tilt-x', '0deg');
            element.style.setProperty('--tilt-y', '0deg');
        });
    });

    const header = document.querySelector('.home-header');
    const updateHeader = () => header?.classList.toggle('is-scrolled', window.scrollY > 42);
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });

    const labToggle = document.querySelector('[data-liquid-lab-toggle]');
    const labPanel = document.querySelector('#liquid-lab-panel');
    if (labToggle && labPanel) {
        labToggle.addEventListener('click', () => {
            const open = labPanel.hidden;
            labPanel.hidden = !open;
            labToggle.setAttribute('aria-expanded', String(open));
        });
    }

    document.querySelectorAll('[data-liquid-control]').forEach((control) => {
        const apply = () => {
            const value = Number(control.value) / 100;
            if (control.dataset.liquidControl === 'motion') {
                renderer.motion = reduceMotion.matches ? 0 : value;
            }
            if (control.dataset.liquidControl === 'clarity') {
                root.style.setProperty('--liquid-blur', `${(31 - value * 19).toFixed(1)}px`);
                root.style.setProperty('--liquid-opacity', (0.2 - value * 0.13).toFixed(3));
            }
            const output = document.querySelector(`[data-liquid-output="${control.dataset.liquidControl}"]`);
            if (output) output.value = control.value;
        };
        control.addEventListener('input', apply);
        apply();
    });

    reduceMotion.addEventListener?.('change', () => {
        const control = document.querySelector('[data-liquid-control="motion"]');
        renderer.motion = reduceMotion.matches ? 0 : Number(control?.value || 64) / 100;
    });
})();
