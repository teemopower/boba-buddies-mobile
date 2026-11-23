/**
 * Type declarations for bundled audio assets.
 * Metro resolves require('./file.wav') to a numeric asset id, which
 * expo-audio accepts as an AudioSource.
 */
declare module '*.wav' {
  const value: number;
  export default value;
}
