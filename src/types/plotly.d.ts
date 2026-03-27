declare module 'plotly.js-dist-min' {
  const Plotly: {
    react: (...args: any[]) => Promise<void>;
    purge: (...args: any[]) => void;
  };

  export default Plotly;
}
