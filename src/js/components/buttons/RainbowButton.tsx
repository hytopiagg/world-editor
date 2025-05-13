import clsx from "clsx";

interface RainbowButtonProps {
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  tier?: 1 | 2 | 3;
  style?: React.CSSProperties;
  type?: "button" | "submit" | "reset";
  text?: string;
}

const RainbowButton = ({
  onClick,
  disabled = false,
  children,
  className,
  tier = 1,
  style,
  type = "button",
  text,
}: RainbowButtonProps) => {
  return (
    <button
      type={type}
      disabled={disabled}
      className={clsx(
        "items-center duration-250 relative flex justify-center bg-rainbow-alt py-4 font-bold text-[#F1F1F1] transition-all",
        "disabled:cursor-not-allowed disabled:opacity-50",
        {
          "rounded-2xl px-8 py-5 text-xl md:text-2xl": tier === 1,
          "rounded-2xl px-6 py-4 text-lg md:text-xl": tier === 2,
          "rounded-2xl px-4 py-3 text-base md:text-lg": tier === 3,
        },
        !disabled && "hover:scale-[1.02] active:translate-y-1 active:scale-[1]",
        className,
      )}
      onClick={onClick}
      style={style}
    >
      {text ? text : null}
      <div className="absolute inset-[2px] flex items-center justify-center rounded-[inherit] bg-[#0D0D0D]/90">
        <div className="select-none bg-rainbow-alt bg-clip-text text-transparent">
          {children}
        </div>
      </div>
    </button>
  );
};

export default RainbowButton;

{
  /* <div className="flex gap-4 text-[20px] font-bold leading-none">
<div
  onClick={openSubmitReviewFlow}
  className={`relative h-[50px] min-w-[175px] rounded-[10px] bg-rainbow-alt px-[20px] py-[16px] text-[#F1F1F1] transition-all duration-[250] ${dataChanged
    ? "cursor-not-allowed opacity-50"
    : "cursor-pointer hover:scale-[1.01] active:scale-[1]"
    }`}
  title={dataChanged ? "Save changes before submitting" : ""}
>
  <div className="absolute inset-[2px] flex items-center justify-center rounded-[10px] bg-[#0D0D0D]/90">
    <div className="select-none bg-rainbow-alt bg-clip-text text-transparent">
      {"Submit Game"}
    </div>
  </div>
</div>
</div> */
}
