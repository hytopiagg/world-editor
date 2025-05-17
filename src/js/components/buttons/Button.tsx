import clsx from "clsx";

interface ButtonProps {
  onClick?: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  design?: "primary" | "secondary" | "tertiary";
  tier?: 1 | 2 | 3;
  style?: React.CSSProperties;
  type?: "button" | "submit" | "reset";
}

const Button = ({
  onClick,
  isActive = false,
  disabled = false,
  children,
  className,
  design = "primary",
  tier = 1,
  style,
  type = "button",
}: ButtonProps) => {
  return (
    <button
      type={type}
      disabled={disabled}
      className={clsx(
        "relative flex select-none cursor-pointer items-center justify-center whitespace-nowrap border-2 border-transparent py-4 font-bold shadow-md transition-all hover:scale-[1.02] active:translate-y-1 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:active:translate-y-0",
        {
          "border-white bg-white text-black hover:border-white/80":
            design === "primary",

          "text-[#F1F1F1] hover:border-white disabled:text-[#F1F1F1]/50 disabled:hover:border-white/10":
            design === "secondary",
          "border-white/10": design === "secondary" && !isActive,
          "border-white": design === "secondary" && isActive,

          "border-white/0 bg-white/10 text-[#F1F1F1]/60 hover:border-white":
            design === "tertiary" && !isActive,
          "border-white bg-transparent text-[#F1F1F1]":
            design === "tertiary" && isActive,

          // "px-8 py-5 text-xl md:text-2xl rounded-2xl": tier > 0,
          "rounded-2xl px-8 py-5 text-xl md:text-2xl": tier === 1,
          "rounded-2xl px-6 py-4 text-lg md:text-xl": tier === 2,
          "rounded-2xl px-4 py-3 text-base md:text-lg": tier === 3,
        },
        className,
      )}
      onClick={onClick}
      style={style}
    >
      {children}
    </button>
  );
};

export default Button;
