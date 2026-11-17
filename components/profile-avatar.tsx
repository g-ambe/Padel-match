"use client";
import { useState, type HTMLAttributes } from "react";
import { avatarGeometry, type AvatarPosition } from "@/lib/profile-media/position";

// 大小のプレビューで同じ正規化座標を使い、表示ピクセル数に依存させない。
export function ProfileAvatar({ image, name, position, className = "h-20 w-20", onSize, onImageError, ...props }: {
 image?: string; name: string; position: AvatarPosition; className?: string;
 onSize?: (width: number, height: number) => void; onImageError?: () => void;
} & HTMLAttributes<HTMLDivElement>) {
 const [size,setSize]=useState<{src:string;w:number;h:number}|null>(null);
 const geometry=size&&size.src===image?avatarGeometry(size.w,size.h,position):null;
 return <div {...props} className={`relative shrink-0 overflow-hidden rounded-full bg-zinc-800 text-accent ${className}`}>
  {image?<img src={image} alt="プロフィール写真" draggable={false} onError={onImageError} onLoad={e=>{const {naturalWidth:w,naturalHeight:h}=e.currentTarget;if(w&&h){setSize({src:image,w,h});onSize?.(w,h);}}} style={geometry?{position:"absolute",maxWidth:"none",width:`${geometry.width*100}%`,height:`${geometry.height*100}%`,left:"50%",top:"50%",transform:`translate(${-geometry.x*100}%,${-geometry.y*100}%)`,pointerEvents:"none",userSelect:"none"}:{width:"100%",height:"100%",objectFit:"cover",pointerEvents:"none"}}/>:<span aria-label="既定のプロフィール写真" className="absolute inset-0 flex items-center justify-center text-3xl font-bold">{Array.from(name.trim())[0]||"P"}</span>}
 </div>;
}
